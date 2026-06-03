import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/domain/auth_cookie.dart';

void main() {
  group('AuthCookie', () {
    test('fromJson/toJson round-trips', () {
      const cookie = AuthCookie(
        name: 'CF_Authorization',
        value: 'jwt-token',
        path: '/',
      );
      final json = cookie.toJson();
      expect(AuthCookie.fromJson(json), equals(cookie));
    });

    test('value equality', () {
      expect(
        const AuthCookie(name: 'a', value: 'b', path: '/'),
        const AuthCookie(name: 'a', value: 'b', path: '/'),
      );
      expect(
        const AuthCookie(name: 'a', value: 'b', path: '/') ==
            const AuthCookie(name: 'x', value: 'b', path: '/'),
        isFalse,
      );
    });
  });

  group('decodeAuthCookies', () {
    test('decodes a valid base64url-encoded JSON list', () {
      final cookies = [
        {'name': 'CF_Authorization', 'value': 'jwt-val', 'path': '/'},
        {'name': 'session', 'value': 'sess123', 'path': '/app'},
      ];
      final encoded = base64Url.encode(utf8.encode(jsonEncode(cookies)));
      final result = decodeAuthCookies(encoded);

      expect(result, hasLength(2));
      expect(result[0].name, 'CF_Authorization');
      expect(result[0].value, 'jwt-val');
      expect(result[0].path, '/');
      expect(result[1].name, 'session');
      expect(result[1].value, 'sess123');
      expect(result[1].path, '/app');
    });

    test('preserves list order', () {
      final names = ['a', 'b', 'c'];
      final cookies = names
          .map((n) => {'name': n, 'value': 'v', 'path': '/'})
          .toList();
      final encoded = base64Url.encode(utf8.encode(jsonEncode(cookies)));
      final result = decodeAuthCookies(encoded);

      expect(result.map((c) => c.name).toList(), names);
    });

    test('returns [] for empty string', () {
      expect(decodeAuthCookies(''), isEmpty);
    });

    test('returns [] for malformed base64', () {
      expect(decodeAuthCookies('!!!not-base64!!!'), isEmpty);
    });

    test('returns [] for valid base64 but not a JSON list', () {
      final encoded =
          base64Url.encode(utf8.encode('{"not": "a list"}'));
      expect(decodeAuthCookies(encoded), isEmpty);
    });

    test('returns [] when JSON list items are malformed (missing name)', () {
      final broken = [
        {'value': 'v', 'path': '/'},
      ];
      final encoded = base64Url.encode(utf8.encode(jsonEncode(broken)));
      expect(decodeAuthCookies(encoded), isEmpty);
    });

    test('round-trips a known base64url string', () {
      // Manually computed: base64url([{"name":"tok","value":"abc","path":"/"}])
      const knownInput = 'W3sibmFtZSI6InRvayIsInZhbHVlIjoiYWJjIiwicGF0aCI6Ii8ifV0';
      final result = decodeAuthCookies(knownInput);
      expect(result, hasLength(1));
      expect(result[0], const AuthCookie(name: 'tok', value: 'abc', path: '/'));
    });

    test('normalises base64url padding (handles strings without trailing =)', () {
      // Build a payload that would need padding when encoded, then strip padding
      final cookies = [
        {'name': 'x', 'value': '1', 'path': '/'},
      ];
      final withPadding =
          base64Url.encode(utf8.encode(jsonEncode(cookies)));
      final withoutPadding = withPadding.replaceAll('=', '');
      final result = decodeAuthCookies(withoutPadding);
      expect(result, hasLength(1));
    });
  });
}
