import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/auth_cookie.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/infrastructure/webview/webview_cookie_harvester.dart';

class _MockCookieManager extends Mock implements CookieManager {}

/// In-memory [SecureStoragePort] mirroring the layout the real Flutter Secure
/// Storage adapter uses (`server.<ns>.<key>`), so we can assert the exact
/// persisted shape — same harness style as the credentials-store tests.
class _FakeStorage implements SecureStoragePort {
  final Map<String, String?> data = <String, String?>{};

  String _key(String serverId, String key) => 'server.$serverId.$key';

  @override
  Future<String?> read(String serverId, String key) async =>
      data[_key(serverId, key)];

  @override
  Future<void> write(String serverId, String key, String value) async {
    data[_key(serverId, key)] = value;
  }

  @override
  Future<void> delete(String serverId, String key) async {
    data.remove(_key(serverId, key));
  }

  @override
  Future<void> deleteAll(String serverId) async {
    data.removeWhere((k, _) => k.startsWith('server.$serverId.'));
  }
}

void main() {
  setUpAll(() {
    registerFallbackValue(WebUri('https://example.com'));
  });

  group('WebViewCookieHarvester.harvestCfAuthorization', () {
    test('reads the HttpOnly CF_Authorization cookie from the jar', () async {
      final cm = _MockCookieManager();
      when(() => cm.getCookies(url: any(named: 'url'))).thenAnswer(
        (_) async => [
          // CF_Authorization is HttpOnly; the native CookieManager still
          // returns it (the harvest's linchpin).
          Cookie(
            name: 'CF_Authorization',
            value: 'cf-jwt-value',
            path: '/',
            isHttpOnly: true,
            domain: 'rdv.joyful.house',
          ),
          // An unrelated cookie that must be ignored.
          Cookie(name: 'other', value: 'x', path: '/'),
        ],
      );

      final harvester = WebViewCookieHarvester(cookieManager: cm);
      final harvested = await harvester.harvestCfAuthorization(
        serverOrigin: Uri.parse('https://rdv.joyful.house'),
      );

      expect(harvested, isNotNull);
      expect(harvested!.name, 'CF_Authorization');
      expect(harvested.value, 'cf-jwt-value');
      expect(harvested.path, '/');
    });

    test('returns null when no CF_Authorization is present (on-LAN)', () async {
      final cm = _MockCookieManager();
      when(() => cm.getCookies(url: any(named: 'url'))).thenAnswer(
        (_) async => [
          // On-LAN there is no Cloudflare edge, so the jar carries only the
          // OIDC session cookie — no CF_Authorization to harvest.
          Cookie(
            name: '__Secure-next-auth.session-token',
            value: 's',
            path: '/',
          ),
        ],
      );

      final harvester = WebViewCookieHarvester(cookieManager: cm);
      final harvested = await harvester.harvestCfAuthorization(
        serverOrigin: Uri.parse('https://rdv.joyful.house'),
      );

      expect(harvested, isNull);
    });

    test('returns null for an empty jar', () async {
      final cm = _MockCookieManager();
      when(() => cm.getCookies(url: any(named: 'url')))
          .thenAnswer((_) async => <Cookie>[]);

      final harvester = WebViewCookieHarvester(cookieManager: cm);
      expect(
        await harvester.harvestCfAuthorization(
          serverOrigin: Uri.parse('https://rdv.joyful.house'),
        ),
        isNull,
      );
    });

    test('returns null for an empty-valued CF_Authorization', () async {
      final cm = _MockCookieManager();
      when(() => cm.getCookies(url: any(named: 'url'))).thenAnswer(
        (_) async => [Cookie(name: 'CF_Authorization', value: '', path: '/')],
      );

      final harvester = WebViewCookieHarvester(cookieManager: cm);
      expect(
        await harvester.harvestCfAuthorization(
          serverOrigin: Uri.parse('https://rdv.joyful.house'),
        ),
        isNull,
      );
    });

    test('respects expiry: skips an already-expired CF_Authorization',
        () async {
      final cm = _MockCookieManager();
      final pastMs = DateTime.now()
          .subtract(const Duration(hours: 1))
          .millisecondsSinceEpoch;
      when(() => cm.getCookies(url: any(named: 'url'))).thenAnswer(
        (_) async => [
          Cookie(
            name: 'CF_Authorization',
            value: 'stale-jwt',
            path: '/',
            expiresDate: pastMs,
          ),
        ],
      );

      final harvester = WebViewCookieHarvester(cookieManager: cm);
      expect(
        await harvester.harvestCfAuthorization(
          serverOrigin: Uri.parse('https://rdv.joyful.house'),
        ),
        isNull,
      );
    });

    test('harvests a CF_Authorization whose expiry is still in the future',
        () async {
      final cm = _MockCookieManager();
      final futureMs =
          DateTime.now().add(const Duration(hours: 1)).millisecondsSinceEpoch;
      when(() => cm.getCookies(url: any(named: 'url'))).thenAnswer(
        (_) async => [
          Cookie(
            name: 'CF_Authorization',
            value: 'live-jwt',
            path: '/',
            expiresDate: futureMs,
          ),
        ],
      );

      final harvester = WebViewCookieHarvester(cookieManager: cm);
      final harvested = await harvester.harvestCfAuthorization(
        serverOrigin: Uri.parse('https://rdv.joyful.house'),
      );
      expect(harvested?.value, 'live-jwt');
    });

    test('defaults an empty path to / (Android without GET_COOKIE_INFO)',
        () async {
      final cm = _MockCookieManager();
      // On Android without WebViewFeature.GET_COOKIE_INFO, path is null.
      when(() => cm.getCookies(url: any(named: 'url'))).thenAnswer(
        (_) async => [Cookie(name: 'CF_Authorization', value: 'v')],
      );

      final harvester = WebViewCookieHarvester(cookieManager: cm);
      final harvested = await harvester.harvestCfAuthorization(
        serverOrigin: Uri.parse('https://rdv.joyful.house'),
      );
      expect(harvested?.path, '/');
    });

    test('is non-fatal when getCookies throws → returns null', () async {
      final cm = _MockCookieManager();
      when(() => cm.getCookies(url: any(named: 'url')))
          .thenThrow(Exception('platform unavailable'));

      final harvester = WebViewCookieHarvester(cookieManager: cm);
      // Must not throw.
      expect(
        await harvester.harvestCfAuthorization(
          serverOrigin: Uri.parse('https://rdv.joyful.house'),
        ),
        isNull,
      );
    });
  });

  group('harvest → persist as a host auth cookie', () {
    test('upsertHostAuthCookie persists the harvested CF cookie host-wide',
        () async {
      // End-to-end of the wiring: harvest from the jar, then persist via the
      // real credentials store so the existing CfAuthInterceptor (which reads
      // getInstanceCookies → getHostAuthCookies) sends it on every Dio call.
      final cm = _MockCookieManager();
      when(() => cm.getCookies(url: any(named: 'url'))).thenAnswer(
        (_) async => [
          Cookie(name: 'CF_Authorization', value: 'cf-jwt', path: '/'),
        ],
      );
      final harvester = WebViewCookieHarvester(cookieManager: cm);
      final store = MobileCredentialsStore(_FakeStorage());

      final harvested = await harvester.harvestCfAuthorization(
        serverOrigin: Uri.parse('https://rdv.joyful.house'),
      );
      expect(harvested, isNotNull);
      await store.upsertHostAuthCookie('host-1', harvested!);

      final persisted = await store.getHostAuthCookies('host-1');
      expect(persisted.length, 1);
      expect(persisted.single.name, 'CF_Authorization');
      expect(persisted.single.value, 'cf-jwt');
    });

    test('upsert merges/replaces CF_Authorization without clobbering others',
        () async {
      final store = MobileCredentialsStore(_FakeStorage());
      // A CF instance callback already stored other host cookies + an old CF.
      await store.setHostAuthCookies('host-1', const [
        AuthCookie(name: 'other', value: 'keep-me', path: '/'),
        AuthCookie(name: 'CF_Authorization', value: 'old-jwt', path: '/'),
      ]);

      await store.upsertHostAuthCookie(
        'host-1',
        const AuthCookie(
          name: 'CF_Authorization',
          value: 'fresh-jwt',
          path: '/',
        ),
      );

      final persisted = await store.getHostAuthCookies('host-1');
      final byName = {for (final c in persisted) c.name: c.value};
      // The unrelated cookie survives; CF_Authorization is replaced, not dupped.
      expect(byName['other'], 'keep-me');
      expect(byName['CF_Authorization'], 'fresh-jwt');
      expect(
        persisted.where((c) => c.name == 'CF_Authorization').length,
        1,
        reason: 'CF_Authorization must be replaced, not duplicated',
      );
    });
  });
}
