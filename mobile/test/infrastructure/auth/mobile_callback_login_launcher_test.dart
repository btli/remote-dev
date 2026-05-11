import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/infrastructure/auth/mobile_callback_login_launcher.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';

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
          // Simulate the system browser firing the callback after a tick.
          scheduleMicrotask(() {
            stream.add(
              Uri.parse(
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

      expect(launchedAt, Uri.parse('https://dev.example.com/auth/mobile-callback'));
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
        urlLauncher: (_) async {
          scheduleMicrotask(() {
            // Wrong scheme — must be ignored.
            stream.add(Uri.parse('https://dev.example.com/auth/callback'));
            // Wrong host — must be ignored.
            stream.add(Uri.parse('remotedev://session/abc'));
            // Wrong path — must be ignored.
            stream.add(Uri.parse('remotedev://auth/other'));
            // Matching URI.
            stream.add(
              Uri.parse('remotedev://auth/callback?apiKey=sk-final'),
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
        urlLauncher: (_) async {
          scheduleMicrotask(() {
            stream.add(Uri.parse('remotedev://auth/callback?cfToken=jwt'));
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
