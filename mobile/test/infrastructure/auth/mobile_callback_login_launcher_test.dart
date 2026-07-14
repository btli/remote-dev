import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/infrastructure/auth/mobile_callback_login_launcher.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';

/// Echo the anti-hijack `state` the launcher appended to [launchedUrl] back onto
/// a `remotedev://auth/callback` deep link — exactly as the real server does.
/// This keeps the realistic "server echoes whatever it received" behavior so
/// the strict state gate (remote-dev-gkuo) accepts the callback.
Uri callbackEchoingState(Uri launchedUrl, String baseCallback) {
  final state = launchedUrl.queryParameters['state'];
  final sep = baseCallback.contains('?') ? '&' : '?';
  return Uri.parse('$baseCallback${sep}state=${Uri.encodeComponent(state ?? '')}');
}

void main() {
  group('MobileCallbackLoginLauncher.login', () {
    test(
        'opens <server>/auth/mobile-callback and resolves with credentials '
        'from remotedev://auth/callback', () async {
      final stream = StreamController<Uri>.broadcast();
      Uri? launchedAt;
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (uri) async {
          launchedAt = uri;
          // Simulate the system browser firing the callback after a tick,
          // echoing the state the launcher appended (as the server does).
          scheduleMicrotask(() {
            stream.add(
              callbackEchoingState(
                uri,
                'remotedev://auth/callback?apiKey=sk-abc'
                    '&userId=u1&email=a%40b.com&cfToken=jwt-token',
              ),
            );
          });
          return true;
        },
      );

      final creds = await launcher.login(
        serverUrl: Uri.parse('https://dev.example.com'),
      );

      // The launched URL carries the anti-hijack state nonce on the path.
      expect(launchedAt, isNotNull);
      expect(launchedAt!.path, '/auth/mobile-callback');
      expect(launchedAt!.queryParameters['state'], isNotEmpty);
      expect(creds, isNotNull);
      expect(creds!.apiKey, 'sk-abc');
      expect(creds.cfToken, 'jwt-token');
      expect(creds.userId, 'u1');
      expect(creds.email, 'a@b.com');

      await stream.close();
    });

    test('returns null when url_launcher reports failure', () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (_) async => false,
      );

      final creds = await launcher.login(
        serverUrl: Uri.parse('https://dev.example.com'),
      );
      expect(creds, isNull);
      await stream.close();
    });

    test('returns null on timeout when no callback URI arrives', () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (_) async => true,
        timeout: const Duration(milliseconds: 50),
      );

      final creds = await launcher.login(
        serverUrl: Uri.parse('https://dev.example.com'),
      );
      expect(creds, isNull);
      await stream.close();
    });

    test('ignores wrong-shape URIs and waits for the matching one',
        () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (uri) async {
          scheduleMicrotask(() {
            // Wrong scheme — must be ignored.
            stream.add(Uri.parse('https://dev.example.com/auth/callback'));
            // Wrong host — must be ignored.
            stream.add(Uri.parse('remotedev://session/abc'));
            // Wrong path — must be ignored.
            stream.add(Uri.parse('remotedev://auth/other'));
            // Matching URI (echoing the state nonce the launcher sent).
            stream.add(
              callbackEchoingState(
                uri,
                'remotedev://auth/callback?apiKey=sk-final',
              ),
            );
          });
          return true;
        },
      );

      final creds = await launcher.login(
        serverUrl: Uri.parse('https://dev.example.com'),
      );
      expect(creds, isNotNull);
      expect(creds!.apiKey, 'sk-final');
      expect(creds.cfToken, isNull);

      await stream.close();
    });

    test('returns null when callback URI lacks apiKey', () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (uri) async {
          scheduleMicrotask(() {
            stream.add(
              callbackEchoingState(
                uri,
                'remotedev://auth/callback?cfToken=jwt',
              ),
            );
          });
          return true;
        },
      );

      final creds = await launcher.login(
        serverUrl: Uri.parse('https://dev.example.com'),
      );
      expect(creds, isNull);
      await stream.close();
    });
  });

  group('MobileCallbackLoginLauncher.loginHost', () {
    test(
        'opens <origin>/auth/mobile-callback and resolves a HostCallback '
        'from remotedev://auth/callback?scope=host', () async {
      final stream = StreamController<Uri>.broadcast();
      Uri? launchedAt;
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (uri) async {
          launchedAt = uri;
          scheduleMicrotask(() {
            stream.add(
              callbackEchoingState(
                uri,
                'remotedev://auth/callback?scope=host&cfToken=host-jwt'
                    '&userId=u9&email=h%40b.com',
              ),
            );
          });
          return true;
        },
      );

      final host = await launcher.loginHost(
        origin: Uri.parse('https://sup.example.com'),
      );

      expect(launchedAt, isNotNull);
      expect(launchedAt!.path, '/auth/mobile-callback');
      expect(launchedAt!.queryParameters['state'], isNotEmpty);
      expect(host.cfToken, 'host-jwt');
      expect(host.userId, 'u9');
      expect(host.email, 'h@b.com');

      await stream.close();
    });

    test('throws MobileCallbackLaunchException when the browser fails to open',
        () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (_) async => false,
      );

      await expectLater(
        launcher.loginHost(origin: Uri.parse('https://sup.example.com')),
        throwsA(isA<MobileCallbackLaunchException>()),
      );
      await stream.close();
    });

    test('throws TimeoutException when no callback arrives', () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (_) async => true,
        timeout: const Duration(milliseconds: 50),
      );

      await expectLater(
        launcher.loginHost(origin: Uri.parse('https://sup.example.com')),
        throwsA(isA<TimeoutException>()),
      );
      await stream.close();
    });

    test(
        'throws MobileCallbackShapeException when the callback is an instance '
        '(apiKey-bearing) shape', () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (uri) async {
          scheduleMicrotask(() {
            stream.add(
              callbackEchoingState(
                uri,
                'remotedev://auth/callback?apiKey=k&cfToken=jwt',
              ),
            );
          });
          return true;
        },
      );

      await expectLater(
        launcher.loginHost(origin: Uri.parse('https://sup.example.com')),
        throwsA(isA<MobileCallbackShapeException>()),
      );
      await stream.close();
    });
  });

  group('MobileCallbackLoginLauncher.loginAny (scope-agnostic bootstrap)', () {
    test('resolves an InstanceCallback for a scope=instance callback', () async {
      final stream = StreamController<Uri>.broadcast();
      Uri? launchedAt;
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (uri) async {
          launchedAt = uri;
          scheduleMicrotask(() {
            stream.add(
              callbackEchoingState(
                uri,
                'remotedev://auth/callback?scope=instance&apiKey=sk-inst'
                    '&cfToken=id-jwt&userId=u1&email=a%40b.com',
              ),
            );
          });
          return true;
        },
      );

      final result = await launcher.loginAny(
        origin: Uri.parse('https://dev.example.com'),
      );

      expect(launchedAt!.path, '/auth/mobile-callback');
      expect(launchedAt!.queryParameters['state'], isNotEmpty);
      expect(result, isA<InstanceCallback>());
      final instance = result! as InstanceCallback;
      expect(instance.apiKey, 'sk-inst');
      expect(instance.cfToken, 'id-jwt');
      expect(instance.email, 'a@b.com');

      await stream.close();
    });

    test(
        'resolves an InstanceCallback for a LEGACY (no scope) apiKey-bearing '
        'callback', () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (uri) async {
          scheduleMicrotask(() {
            stream.add(
              callbackEchoingState(
                uri,
                'remotedev://auth/callback?apiKey=sk-legacy&cfToken=jwt',
              ),
            );
          });
          return true;
        },
      );

      final result = await launcher.loginAny(
        origin: Uri.parse('https://dev.example.com'),
      );
      expect(result, isA<InstanceCallback>());
      expect((result! as InstanceCallback).apiKey, 'sk-legacy');
      await stream.close();
    });

    test('resolves a HostCallback for a scope=host callback', () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (uri) async {
          scheduleMicrotask(() {
            stream.add(
              callbackEchoingState(
                uri,
                'remotedev://auth/callback?scope=host&cfToken=host-jwt'
                    '&userId=u9&email=h%40b.com',
              ),
            );
          });
          return true;
        },
      );

      final result = await launcher.loginAny(
        origin: Uri.parse('https://sup.example.com'),
      );
      expect(result, isA<HostCallback>());
      expect((result! as HostCallback).cfToken, 'host-jwt');
      await stream.close();
    });

    test('returns null (NOT throws) when the browser fails to open', () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (_) async => false,
      );

      expect(
        await launcher.loginAny(origin: Uri.parse('https://dev.example.com')),
        isNull,
      );
      await stream.close();
    });

    test('returns null (NOT throws) on timeout', () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        urlLauncher: (_) async => true,
        timeout: const Duration(milliseconds: 50),
      );

      expect(
        await launcher.loginAny(origin: Uri.parse('https://dev.example.com')),
        isNull,
      );
      await stream.close();
    });
  });

  test('MobileCredentials default constructor preserves fields', () {
    const c = MobileCredentials(
      apiKey: 'k',
      cfToken: 't',
      userId: 'u',
      email: 'e',
    );
    expect(c.apiKey, 'k');
    expect(c.cfToken, 't');
    expect(c.userId, 'u');
    expect(c.email, 'e');
  });
}
