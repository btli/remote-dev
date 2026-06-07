// Tests for the QR provisioning payload parser (remote-dev-8xfo):
//   - a versioned CF service-token envelope parses to CfServiceTokenPayload
//   - the legacy {url, port, apiKey} shape (no `type`) parses to
//     LegacyServerPayload, with port optional/coerced
//   - unknown type / version / malformed JSON / missing fields => QrPayloadError
//   - origin normalisation + same-host matching helper
//   - secrets never leak via toString
//
// NOTE: fixture credential values are deliberately obvious placeholders
// ("placeholder-secret", etc.) so no realistic-looking secret rides in the
// test source.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/domain/qr_payload.dart';

void main() {
  group('QrPayload.parse — CF service-token envelope', () {
    test('parses a complete v1 cfServiceToken envelope', () {
      final raw = jsonEncode({
        'v': 1,
        'type': 'rdv.cfServiceToken',
        'host': 'https://dev.example.com',
        'clientId': 'cid.public',
        'clientSecret': 'placeholder-secret',
      });

      final payload = QrPayload.parse(raw);

      expect(payload, isA<CfServiceTokenPayload>());
      final token = payload as CfServiceTokenPayload;
      expect(token.host, 'https://dev.example.com');
      expect(token.clientId, 'cid.public');
      expect(token.clientSecret, 'placeholder-secret');
    });

    test('trims whitespace around host and clientId', () {
      final raw = jsonEncode({
        'v': 1,
        'type': 'rdv.cfServiceToken',
        'host': '  https://dev.example.com  ',
        'clientId': '  cid.public  ',
        'clientSecret': 'placeholder-secret',
      });

      final token = QrPayload.parse(raw) as CfServiceTokenPayload;
      expect(token.host, 'https://dev.example.com');
      expect(token.clientId, 'cid.public');
      // The secret is preserved verbatim (not trimmed) — it is opaque.
      expect(token.clientSecret, 'placeholder-secret');
    });

    test('rejects an unknown envelope type', () {
      final raw = jsonEncode({
        'v': 1,
        'type': 'rdv.somethingElse',
        'host': 'https://dev.example.com',
      });

      expect(
        () => QrPayload.parse(raw),
        throwsA(
          isA<QrPayloadError>().having(
            (e) => e.message,
            'message',
            contains('Unsupported QR code type'),
          ),
        ),
      );
    });

    test('rejects an unsupported (newer) version', () {
      final raw = jsonEncode({
        'v': 2,
        'type': 'rdv.cfServiceToken',
        'host': 'https://dev.example.com',
        'clientId': 'cid',
        'clientSecret': 'placeholder-secret',
      });

      expect(
        () => QrPayload.parse(raw),
        throwsA(
          isA<QrPayloadError>().having(
            (e) => e.message,
            'message',
            contains('newer version'),
          ),
        ),
      );
    });

    test('rejects an envelope missing the version', () {
      final raw = jsonEncode({
        'type': 'rdv.cfServiceToken',
        'host': 'https://dev.example.com',
        'clientId': 'cid',
        'clientSecret': 'placeholder-secret',
      });

      expect(() => QrPayload.parse(raw), throwsA(isA<QrPayloadError>()));
    });

    test('rejects a cfServiceToken envelope missing clientSecret', () {
      final raw = jsonEncode({
        'v': 1,
        'type': 'rdv.cfServiceToken',
        'host': 'https://dev.example.com',
        'clientId': 'cid',
      });

      expect(
        () => QrPayload.parse(raw),
        throwsA(
          isA<QrPayloadError>().having(
            (e) => e.message,
            'message',
            contains('incomplete'),
          ),
        ),
      );
    });

    test('rejects a cfServiceToken envelope with a blank host', () {
      final raw = jsonEncode({
        'v': 1,
        'type': 'rdv.cfServiceToken',
        'host': '   ',
        'clientId': 'cid',
        'clientSecret': 'placeholder-secret',
      });

      expect(() => QrPayload.parse(raw), throwsA(isA<QrPayloadError>()));
    });

    test('rejects an envelope whose type is not a string', () {
      final raw = jsonEncode({'v': 1, 'type': 42, 'host': 'x'});
      expect(() => QrPayload.parse(raw), throwsA(isA<QrPayloadError>()));
    });
  });

  group('QrPayload.parse — legacy server payload', () {
    test('parses {url, port, apiKey} into LegacyServerPayload', () {
      final raw = jsonEncode({
        'url': 'https://dev.example.com',
        'port': '6002',
        'apiKey': 'placeholder-api-key',
      });

      final payload = QrPayload.parse(raw);
      expect(payload, isA<LegacyServerPayload>());
      final legacy = payload as LegacyServerPayload;
      expect(legacy.url, 'https://dev.example.com');
      expect(legacy.port, '6002');
      expect(legacy.apiKey, 'placeholder-api-key');
    });

    test('treats port as optional (absent => null)', () {
      final raw = jsonEncode({
        'url': 'https://dev.example.com',
        'apiKey': 'placeholder-api-key',
      });

      final legacy = QrPayload.parse(raw) as LegacyServerPayload;
      expect(legacy.port, isNull);
      expect(legacy.url, 'https://dev.example.com');
    });

    test('coerces a numeric port to a string', () {
      final raw = jsonEncode({
        'url': 'https://dev.example.com',
        'port': 6002,
        'apiKey': 'placeholder-api-key',
      });

      final legacy = QrPayload.parse(raw) as LegacyServerPayload;
      expect(legacy.port, '6002');
    });

    test('rejects a legacy payload with an empty apiKey', () {
      final raw = jsonEncode({'url': 'https://dev.example.com', 'apiKey': ''});
      expect(() => QrPayload.parse(raw), throwsA(isA<QrPayloadError>()));
    });

    test('rejects a legacy payload with an empty url', () {
      final raw = jsonEncode({'url': '', 'apiKey': 'placeholder-api-key'});
      expect(() => QrPayload.parse(raw), throwsA(isA<QrPayloadError>()));
    });

    test('an object with neither type nor url+apiKey is rejected', () {
      final raw = jsonEncode({'url': 'https://dev.example.com'});
      expect(() => QrPayload.parse(raw), throwsA(isA<QrPayloadError>()));
    });
  });

  group('QrPayload.parse — malformed input', () {
    test('rejects non-JSON text', () {
      expect(() => QrPayload.parse('not json'), throwsA(isA<QrPayloadError>()));
    });

    test('rejects a JSON array', () {
      expect(() => QrPayload.parse('[1,2,3]'), throwsA(isA<QrPayloadError>()));
    });

    test('rejects a bare JSON string', () {
      expect(() => QrPayload.parse('"hello"'), throwsA(isA<QrPayloadError>()));
    });

    test('rejects an empty string', () {
      expect(() => QrPayload.parse(''), throwsA(isA<QrPayloadError>()));
    });

    test('tolerates surrounding whitespace around valid JSON', () {
      final raw =
          '\n  ${jsonEncode({'url': 'https://h', 'apiKey': 'placeholder-api-key'})}  \n';
      expect(QrPayload.parse(raw), isA<LegacyServerPayload>());
    });
  });

  group('origin normalisation + matching', () {
    test('normalizeQrOrigin lowercases and strips path/trailing slash', () {
      expect(
        normalizeQrOrigin('HTTPS://Dev.Example.COM/some/path/'),
        'https://dev.example.com',
      );
    });

    test('normalizeQrOrigin preserves an explicit port', () {
      expect(normalizeQrOrigin('http://host:8080/x'), 'http://host:8080');
    });

    test('originsMatch is true for the same host with differing case/path', () {
      expect(
        originsMatch(
          'https://dev.example.com',
          'https://DEV.example.com/dashboard',
        ),
        isTrue,
      );
    });

    test('originsMatch is false for different hosts', () {
      expect(
        originsMatch('https://a.example.com', 'https://b.example.com'),
        isFalse,
      );
    });

    test('originsMatch is false when ports differ', () {
      expect(
        originsMatch('https://host:443', 'https://host:8443'),
        isFalse,
      );
    });
  });

  group('security', () {
    test('CfServiceTokenPayload.toString never reveals the secret', () {
      const payload = CfServiceTokenPayload(
        host: 'https://dev.example.com',
        clientId: 'cid.public',
        clientSecret: 'top-secret-placeholder',
      );

      expect(payload.toString(), isNot(contains('top-secret-placeholder')));
    });
  });
}
