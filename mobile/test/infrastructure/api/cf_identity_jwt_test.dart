// Unit tests for cfCookieIsFreshIdentity — the deterministic, client-side
// discriminator that decodes a CF_Authorization JWT's public `exp` claim to
// decide whether to prefer the identity cookie or the (non-identity) service
// token on a given request. Verifies: future/expired exp, the skew guard, a
// pinned `now`, base64url padding variants, and every "treat as expired" path
// (null, empty, structurally malformed, non-JSON, exp-less, string exp).
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/infrastructure/api/cf_identity_jwt.dart';

/// Build an unsigned `header.payload.` JWT carrying [claims]. base64url is
/// emitted WITHOUT `=` padding, exactly like a real token, so the decoder's
/// re-padding is exercised.
String _jwt(Map<String, dynamic> claims) {
  String seg(Map<String, dynamic> m) =>
      base64Url.encode(utf8.encode(jsonEncode(m))).replaceAll('=', '');
  return '${seg(<String, dynamic>{'alg': 'RS256'})}.${seg(claims)}.';
}

void main() {
  // A fixed reference instant so exp comparisons are deterministic.
  final now = DateTime.utc(2026, 1, 1, 12);
  int epoch(DateTime d) => d.millisecondsSinceEpoch ~/ 1000;

  group('cfCookieIsFreshIdentity — fresh', () {
    test('exp comfortably in the future → true', () {
      final jwt = _jwt(<String, dynamic>{
        'email': 'a@b.com',
        'exp': epoch(now.add(const Duration(hours: 1))),
      });
      expect(cfCookieIsFreshIdentity(jwt, now: now), isTrue);
    });

    test('a real-JWT payload with extra claims still decodes', () {
      final jwt = _jwt(<String, dynamic>{
        'aud': ['x'],
        'email': 'a@b.com',
        'sub': 'user-1',
        'iat': epoch(now),
        'exp': epoch(now.add(const Duration(minutes: 30))),
      });
      expect(cfCookieIsFreshIdentity(jwt, now: now), isTrue);
    });

    test('exp as a double is coerced', () {
      final jwt = _jwt(<String, dynamic>{
        'exp': epoch(now.add(const Duration(hours: 1))).toDouble(),
      });
      expect(cfCookieIsFreshIdentity(jwt, now: now), isTrue);
    });
  });

  group('cfCookieIsFreshIdentity — stale/expired', () {
    test('exp in the past → false', () {
      final jwt = _jwt(<String, dynamic>{
        'exp': epoch(now.subtract(const Duration(hours: 1))),
      });
      expect(cfCookieIsFreshIdentity(jwt, now: now), isFalse);
    });

    test('exp inside the default 30s skew window → false', () {
      final jwt = _jwt(<String, dynamic>{
        'exp': epoch(now.add(const Duration(seconds: 10))),
      });
      expect(cfCookieIsFreshIdentity(jwt, now: now), isFalse);
    });

    test('exp exactly at now+skew → false (must be strictly after)', () {
      final jwt = _jwt(<String, dynamic>{
        'exp': epoch(now.add(kCfIdentitySkew)),
      });
      expect(cfCookieIsFreshIdentity(jwt, now: now), isFalse);
    });

    test('exp just past the skew window → true', () {
      final jwt = _jwt(<String, dynamic>{
        'exp': epoch(now.add(kCfIdentitySkew + const Duration(seconds: 5))),
      });
      expect(cfCookieIsFreshIdentity(jwt, now: now), isTrue);
    });

    test('a custom skew is honoured', () {
      final jwt = _jwt(<String, dynamic>{
        'exp': epoch(now.add(const Duration(minutes: 2))),
      });
      // Within a 5-minute skew → treated as expired.
      expect(
        cfCookieIsFreshIdentity(jwt, now: now, skew: const Duration(minutes: 5)),
        isFalse,
      );
      // Within a 1-minute skew → fresh.
      expect(
        cfCookieIsFreshIdentity(jwt, now: now, skew: const Duration(minutes: 1)),
        isTrue,
      );
    });
  });

  group('cfCookieIsFreshIdentity — treated as expired (never throws)', () {
    test('null → false', () {
      expect(cfCookieIsFreshIdentity(null, now: now), isFalse);
    });

    test('empty string → false', () {
      expect(cfCookieIsFreshIdentity('', now: now), isFalse);
    });

    test('single segment (no payload) → false', () {
      expect(cfCookieIsFreshIdentity('onlyoneseg', now: now), isFalse);
    });

    test('payload is not valid base64url → false', () {
      // '@@@' is outside the base64url alphabet.
      expect(cfCookieIsFreshIdentity('h.@@@.s', now: now), isFalse);
    });

    test('payload decodes but is not JSON → false', () {
      final seg = base64Url.encode(utf8.encode('not json')).replaceAll('=', '');
      expect(cfCookieIsFreshIdentity('h.$seg.s', now: now), isFalse);
    });

    test('payload is a JSON array, not an object → false', () {
      final seg = base64Url.encode(utf8.encode('[1,2,3]')).replaceAll('=', '');
      expect(cfCookieIsFreshIdentity('h.$seg.s', now: now), isFalse);
    });

    test('object without an exp claim → false', () {
      final jwt = _jwt(<String, dynamic>{'email': 'a@b.com'});
      expect(cfCookieIsFreshIdentity(jwt, now: now), isFalse);
    });

    test('exp as a non-numeric string → false', () {
      final jwt = _jwt(<String, dynamic>{'exp': 'soon'});
      expect(cfCookieIsFreshIdentity(jwt, now: now), isFalse);
    });

    test('exp as a numeric string → coerced and honoured', () {
      final future = epoch(now.add(const Duration(hours: 1))).toString();
      final jwt = _jwt(<String, dynamic>{'exp': future});
      expect(cfCookieIsFreshIdentity(jwt, now: now), isTrue);
    });
  });

  group('cfCookieIsFreshIdentity — base64url padding variants', () {
    // Cover payload byte-lengths that leave remainders of 0/1/2/3 mod 4 after
    // base64url encoding, so the decoder's re-padding is exercised for each.
    for (final pad in <String>['a', 'ab', 'abc', 'abcd', 'abcde']) {
      test('payload padding variant ("$pad") decodes', () {
        final jwt = _jwt(<String, dynamic>{
          'pad': pad,
          'exp': epoch(now.add(const Duration(hours: 1))),
        });
        expect(cfCookieIsFreshIdentity(jwt, now: now), isTrue);
      });
    }
  });
}
