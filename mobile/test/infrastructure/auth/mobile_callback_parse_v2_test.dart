import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/infrastructure/auth/mobile_callback_login_launcher.dart';

/// Encode a list of cookie maps to base64url JSON for use in test URIs.
String _encodeCookies(List<Map<String, String>> cookies) {
  return base64Url.encode(utf8.encode(jsonEncode(cookies)));
}

void main() {
  // ---------------------------------------------------------------------------
  // buildCallbackUrl (base-path bug fix)
  // ---------------------------------------------------------------------------
  group('buildCallbackUrl', () {
    test('host root: https://h -> https://h/auth/mobile-callback', () {
      expect(
        buildCallbackUrl(Uri.parse('https://h')),
        Uri.parse('https://h/auth/mobile-callback'),
      );
    });

    test(
        'workspace prefix: https://h/demo -> https://h/demo/auth/mobile-callback',
        () {
      expect(
        buildCallbackUrl(Uri.parse('https://h/demo')),
        Uri.parse('https://h/demo/auth/mobile-callback'),
      );
    });

    test(
        'trailing slash stripped: https://h/demo/ -> https://h/demo/auth/mobile-callback',
        () {
      expect(
        buildCallbackUrl(Uri.parse('https://h/demo/')),
        Uri.parse('https://h/demo/auth/mobile-callback'),
      );
    });

    test(
        'empty path (origin only): https://host -> https://host/auth/mobile-callback',
        () {
      expect(
        buildCallbackUrl(Uri.parse('https://host')),
        Uri.parse('https://host/auth/mobile-callback'),
      );
    });

    test('nested path: https://h/a/b -> https://h/a/b/auth/mobile-callback',
        () {
      expect(
        buildCallbackUrl(Uri.parse('https://h/a/b')),
        Uri.parse('https://h/a/b/auth/mobile-callback'),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // parseMobileCallback — new precedence + authCookies field
  // ---------------------------------------------------------------------------
  group('parseMobileCallback (authCookies + scope precedence)', () {
    final cookiesJson = [
      {'name': 'CF_Authorization', 'value': 'jwt-val', 'path': '/'},
    ];
    final cookiesEncoded = _encodeCookies(
      cookiesJson.map((m) => m.cast<String, String>()).toList(),
    );

    // ---- scope=host ----
    test('scope=host with authCookies -> HostCallback.authCookies decoded', () {
      final result = parseMobileCallback(
        Uri.parse(
          'remotedev://auth/callback?scope=host'
          '&authCookies=$cookiesEncoded'
          '&email=a%40b.com&userId=u1',
        ),
      );
      expect(result, isA<HostCallback>());
      final host = result! as HostCallback;
      expect(host.authCookies, hasLength(1));
      expect(host.authCookies[0].name, 'CF_Authorization');
      expect(host.authCookies[0].value, 'jwt-val');
    });

    test('scope=host wins even when apiKey is present', () {
      final result = parseMobileCallback(
        Uri.parse(
          'remotedev://auth/callback?scope=host&apiKey=k'
          '&authCookies=$cookiesEncoded',
        ),
      );
      expect(result, isA<HostCallback>());
    });

    // ---- scope=instance ----
    test(
        'scope=instance, no apiKey -> InstanceCallback with authCookies, apiKey null',
        () {
      final result = parseMobileCallback(
        Uri.parse(
          'remotedev://auth/callback?scope=instance'
          '&authCookies=$cookiesEncoded'
          '&email=a%40b.com&userId=u1',
        ),
      );
      expect(result, isA<InstanceCallback>());
      final inst = result! as InstanceCallback;
      expect(inst.apiKey, isNull);
      expect(inst.authCookies, hasLength(1));
      expect(inst.authCookies[0].name, 'CF_Authorization');
    });

    test('scope=instance with apiKey -> InstanceCallback with both', () {
      final result = parseMobileCallback(
        Uri.parse(
          'remotedev://auth/callback?scope=instance&apiKey=mykey'
          '&authCookies=$cookiesEncoded',
        ),
      );
      expect(result, isA<InstanceCallback>());
      final inst = result! as InstanceCallback;
      expect(inst.apiKey, 'mykey');
      expect(inst.authCookies, hasLength(1));
    });

    // ---- legacy (no scope) ----
    test(
        'legacy no-scope + apiKey -> InstanceCallback (authCookies synthesized from cfToken)',
        () {
      final result = parseMobileCallback(
        Uri.parse(
          'remotedev://auth/callback?apiKey=legacy-key&cfToken=cf-jwt'
          '&email=a%40b.com&userId=u1',
        ),
      );
      expect(result, isA<InstanceCallback>());
      final inst = result! as InstanceCallback;
      expect(inst.apiKey, 'legacy-key');
      expect(inst.authCookies, hasLength(1));
      expect(inst.authCookies[0].name, 'CF_Authorization');
      expect(inst.authCookies[0].value, 'cf-jwt');
      expect(inst.authCookies[0].path, '/');
    });

    test(
        'legacy no-scope no-apiKey -> HostCallback (authCookies synthesized from cfToken)',
        () {
      final result = parseMobileCallback(
        Uri.parse(
          'remotedev://auth/callback?cfToken=host-jwt'
          '&email=h%40b.com&userId=u9',
        ),
      );
      expect(result, isA<HostCallback>());
      final host = result! as HostCallback;
      expect(host.authCookies, hasLength(1));
      expect(host.authCookies[0].name, 'CF_Authorization');
      expect(host.authCookies[0].value, 'host-jwt');
    });

    test('malformed authCookies param -> authCookies is []', () {
      final result = parseMobileCallback(
        Uri.parse(
          'remotedev://auth/callback?scope=host&authCookies=!!!bad!!!',
        ),
      );
      expect(result, isA<HostCallback>());
      final host = result! as HostCallback;
      expect(host.authCookies, isEmpty);
    });

    test('no authCookies param and no cfToken -> authCookies is []', () {
      final result = parseMobileCallback(
        Uri.parse('remotedev://auth/callback?scope=host'),
      );
      expect(result, isA<HostCallback>());
      final host = result! as HostCallback;
      expect(host.authCookies, isEmpty);
    });

    // ---- existing fields preserved ----
    test('InstanceCallback preserves cfToken, email, userId', () {
      final result = parseMobileCallback(
        Uri.parse(
          'remotedev://auth/callback?apiKey=k&cfToken=ey.jwt'
          '&email=a%40b.com&userId=u1',
        ),
      );
      final inst = result! as InstanceCallback;
      expect(inst.cfToken, 'ey.jwt');
      expect(inst.email, 'a@b.com');
      expect(inst.userId, 'u1');
    });

    test('HostCallback preserves cfToken, email, userId', () {
      final result = parseMobileCallback(
        Uri.parse(
          'remotedev://auth/callback?scope=host&cfToken=host-jwt'
          '&email=h%40b.com&userId=u9',
        ),
      );
      final host = result! as HostCallback;
      expect(host.cfToken, 'host-jwt');
      expect(host.email, 'h@b.com');
      expect(host.userId, 'u9');
    });
  });

  // ---------------------------------------------------------------------------
  // Launcher: _awaitCallback opens buildCallbackUrl (base-path fix)
  // ---------------------------------------------------------------------------
  group('MobileCallbackLoginLauncher._awaitCallback (base-path fix)', () {
    // Echo the anti-forgery `state` the launcher appended (as the server does)
    // so the strict state gate (remote-dev-gkuo) accepts the callback.
    Uri echoState(Uri launchedUrl, String baseCallback) {
      final state = launchedUrl.queryParameters['state'];
      final sep = baseCallback.contains('?') ? '&' : '?';
      return Uri.parse(
        '$baseCallback${sep}state=${Uri.encodeComponent(state ?? '')}',
      );
    }

    test('login() opens workspace base URL correctly', () async {
      // Verify that a workspace base URL (with path) is not stripped.
      // https://h/demo -> https://h/demo/auth/mobile-callback (+ ?state=…)
      final stream = StreamController<Uri>.broadcast();
      Uri? launchedAt;
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (uri) async {
          launchedAt = uri;
          scheduleMicrotask(() {
            stream.add(
              echoState(uri, 'remotedev://auth/callback?apiKey=k&cfToken=t'),
            );
          });
          return true;
        },
      );

      await launcher.login(serverUrl: Uri.parse('https://h/demo'));

      // Path (base-path prefix) is preserved; the launcher additionally appends
      // the anti-forgery state nonce as a query param.
      expect(launchedAt, isNotNull);
      // Base-path prefix is preserved on the path; the launcher additionally
      // appends the anti-forgery state nonce as a query param.
      expect(launchedAt!.scheme, 'https');
      expect(launchedAt!.host, 'h');
      expect(launchedAt!.path, '/demo/auth/mobile-callback');
      expect(launchedAt!.queryParameters['state'], isNotEmpty);
      await stream.close();
    });

    test('loginHost() opens workspace base URL correctly', () async {
      final stream = StreamController<Uri>.broadcast();
      Uri? launchedAt;
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (uri) async {
          launchedAt = uri;
          scheduleMicrotask(() {
            stream.add(
              echoState(
                uri,
                'remotedev://auth/callback?scope=host&cfToken=host-jwt',
              ),
            );
          });
          return true;
        },
      );

      await launcher.loginHost(origin: Uri.parse('https://h/demo'));

      expect(launchedAt, isNotNull);
      // Base-path prefix is preserved on the path; the launcher additionally
      // appends the anti-forgery state nonce as a query param.
      expect(launchedAt!.scheme, 'https');
      expect(launchedAt!.host, 'h');
      expect(launchedAt!.path, '/demo/auth/mobile-callback');
      expect(launchedAt!.queryParameters['state'], isNotEmpty);
      await stream.close();
    });
  });
}
