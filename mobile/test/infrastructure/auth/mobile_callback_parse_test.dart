import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/infrastructure/auth/mobile_callback_login_launcher.dart';

void main() {
  group('parseMobileCallback', () {
    test('scope=host yields a HostCallback (no apiKey)', () {
      final result = parseMobileCallback(
        Uri.parse(
          'remotedev://auth/callback?scope=host&cfToken=ey.jwt'
          '&email=a%40b.com&userId=u1',
        ),
      );

      expect(result, isA<HostCallback>());
      final host = result! as HostCallback;
      expect(host.cfToken, 'ey.jwt');
      expect(host.email, 'a@b.com');
      expect(host.userId, 'u1');
    });

    test('apiKey present yields an InstanceCallback', () {
      final result = parseMobileCallback(
        Uri.parse(
          'remotedev://auth/callback?apiKey=k&cfToken=ey.jwt'
          '&email=a%40b.com&userId=u1',
        ),
      );

      expect(result, isA<InstanceCallback>());
      final inst = result! as InstanceCallback;
      expect(inst.apiKey, 'k');
      expect(inst.cfToken, 'ey.jwt');
      expect(inst.email, 'a@b.com');
      expect(inst.userId, 'u1');
    });

    test('a non-callback URI returns null', () {
      // Wrong scheme.
      expect(
        parseMobileCallback(Uri.parse('https://dev.example.com/auth/callback')),
        isNull,
      );
      // Wrong host.
      expect(
        parseMobileCallback(Uri.parse('remotedev://session/abc')),
        isNull,
      );
      // Wrong path.
      expect(
        parseMobileCallback(Uri.parse('remotedev://auth/other')),
        isNull,
      );
    });

    test(
        'a callback missing apiKey but without scope is a HostCallback '
        '(apiKey-absence rule)', () {
      final result = parseMobileCallback(
        Uri.parse(
          'remotedev://auth/callback?cfToken=ey.jwt&email=a%40b.com&userId=u1',
        ),
      );

      expect(result, isA<HostCallback>());
      final host = result! as HostCallback;
      expect(host.cfToken, 'ey.jwt');
      expect(host.email, 'a@b.com');
      expect(host.userId, 'u1');
    });

    test('an empty apiKey is treated as host (apiKey-absence rule)', () {
      final result = parseMobileCallback(
        Uri.parse('remotedev://auth/callback?apiKey=&cfToken=ey.jwt'),
      );
      expect(result, isA<HostCallback>());
    });

    test('scope=host wins even if an apiKey is somehow present', () {
      // Defensive: the contract says the app distinguishes by scope=host OR
      // apiKey-absence. An explicit host scope must not be misread as instance.
      final result = parseMobileCallback(
        Uri.parse('remotedev://auth/callback?scope=host&apiKey=k&cfToken=ey'),
      );
      expect(result, isA<HostCallback>());
    });

    test('missing best-effort fields default to empty strings', () {
      final result = parseMobileCallback(
        Uri.parse('remotedev://auth/callback?apiKey=k'),
      );
      final inst = result! as InstanceCallback;
      expect(inst.apiKey, 'k');
      expect(inst.cfToken, '');
      expect(inst.email, '');
      expect(inst.userId, '');
    });
  });
}
