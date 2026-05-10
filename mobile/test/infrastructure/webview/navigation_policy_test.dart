import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/infrastructure/webview/navigation_policy.dart';

void main() {
  group('default policy (in-session)', () {
    final policy = NavigationPolicy(
      serverOrigin: Uri.parse('https://dev.example.com'),
    );

    test('allows /m/* on the server origin', () {
      expect(
        policy.decide(Uri.parse('https://dev.example.com/m/session/abc')),
        NavigationDecision.allow,
      );
    });

    test('intercepts non-/m/ on the server origin', () {
      expect(
        policy.decide(Uri.parse('https://dev.example.com/sessions')),
        NavigationDecision.intercept,
      );
    });

    test('allows Cloudflare Access challenge URLs', () {
      expect(
        policy.decide(Uri.parse('https://example.cloudflareaccess.com/login')),
        NavigationDecision.allow,
      );
    });

    test('opens external links externally', () {
      expect(
        policy.decide(Uri.parse('https://github.com/btli/remote-dev')),
        NavigationDecision.interceptAndOpenExternally,
      );
    });

    test('does NOT allow Google SSO in the default policy', () {
      // Terminal output could contain a google.com link; we deliberately
      // don't auto-load those in-place during a session.
      expect(
        policy.decide(Uri.parse('https://accounts.google.com/o/oauth2/auth')),
        NavigationDecision.interceptAndOpenExternally,
      );
    });
  });

  group('per-screen path scope (bvlw)', () {
    // The strict in-session policy allows any path under
    // `<serverOrigin>/m/*`. When [allowedPathPrefixes] is supplied,
    // each per-surface host (RecordingScreen, ChannelScreen,
    // SessionViewScreen/SessionRouteHost) narrows that allow list to
    // its own PWA route so a same-origin redirect into a sister
    // surface is intercepted instead of silently navigating in-place.

    test(
      'recording-scoped policy intercepts a sister `/m/channel/*` path on '
      'the same origin even though it is under `/m/*`',
      () {
        final policy = NavigationPolicy(
          serverOrigin: Uri.parse('https://dev.example.com'),
          allowedPathPrefixes: const ['/m/recording/'],
        );
        // The route the recording host is pinned to is still allowed…
        expect(
          policy.decide(
            Uri.parse('https://dev.example.com/m/recording/abc'),
          ),
          NavigationDecision.allow,
        );
        // …but a sibling `/m/channel/x` on the same origin is NOT.
        expect(
          policy.decide(
            Uri.parse('https://dev.example.com/m/channel/x'),
          ),
          NavigationDecision.intercept,
        );
      },
    );

    test(
      'channel-scoped policy intercepts `/m/session/*` on the same origin',
      () {
        final policy = NavigationPolicy(
          serverOrigin: Uri.parse('https://dev.example.com'),
          allowedPathPrefixes: const ['/m/channel/'],
        );
        expect(
          policy.decide(Uri.parse('https://dev.example.com/m/channel/c1')),
          NavigationDecision.allow,
        );
        expect(
          policy.decide(Uri.parse('https://dev.example.com/m/session/s1')),
          NavigationDecision.intercept,
        );
      },
    );

    test(
      'session-scoped policy intercepts `/m/recording/*` on the same origin',
      () {
        final policy = NavigationPolicy(
          serverOrigin: Uri.parse('https://dev.example.com'),
          allowedPathPrefixes: const ['/m/session/'],
        );
        expect(
          policy.decide(Uri.parse('https://dev.example.com/m/session/abc')),
          NavigationDecision.allow,
        );
        expect(
          policy.decide(
            Uri.parse('https://dev.example.com/m/recording/abc'),
          ),
          NavigationDecision.intercept,
        );
      },
    );

    test(
      'path scope still defers to the broader rules — CF Access challenge '
      'and external links route as in the default policy',
      () {
        final policy = NavigationPolicy(
          serverOrigin: Uri.parse('https://dev.example.com'),
          allowedPathPrefixes: const ['/m/recording/'],
        );
        // CF Access challenge: still allowed (must precede the path check).
        expect(
          policy.decide(
            Uri.parse('https://example.cloudflareaccess.com/cdn-cgi/access'),
          ),
          NavigationDecision.allow,
        );
        // Off-origin: still routed externally.
        expect(
          policy.decide(Uri.parse('https://github.com/btli/remote-dev')),
          NavigationDecision.interceptAndOpenExternally,
        );
        // Same-origin non-`/m/` path: still intercepted.
        expect(
          policy.decide(Uri.parse('https://dev.example.com/sessions')),
          NavigationDecision.intercept,
        );
      },
    );

    test(
      'multiple prefixes: any one match is enough',
      () {
        // Defensive: the API takes a list, so a host that legitimately
        // hosts two surfaces (e.g. future combined route) should be able
        // to list both.
        final policy = NavigationPolicy(
          serverOrigin: Uri.parse('https://dev.example.com'),
          allowedPathPrefixes: const ['/m/recording/', '/m/channel/'],
        );
        expect(
          policy.decide(
            Uri.parse('https://dev.example.com/m/recording/r1'),
          ),
          NavigationDecision.allow,
        );
        expect(
          policy.decide(Uri.parse('https://dev.example.com/m/channel/c1')),
          NavigationDecision.allow,
        );
        expect(
          policy.decide(Uri.parse('https://dev.example.com/m/session/s1')),
          NavigationDecision.intercept,
        );
      },
    );

    test(
      'empty prefix list rejects every `/m/*` path (no implicit fallback)',
      () {
        // Guard rails: an empty list means "nothing matches". This is the
        // safe default — if a caller accidentally clears the list, they
        // get a hard block, not a silent open-allow.
        final policy = NavigationPolicy(
          serverOrigin: Uri.parse('https://dev.example.com'),
          allowedPathPrefixes: const [],
        );
        expect(
          policy.decide(
            Uri.parse('https://dev.example.com/m/recording/abc'),
          ),
          NavigationDecision.intercept,
        );
      },
    );

    test(
      'null prefix list preserves the default `/m/*` broad behavior',
      () {
        // Regression: callers that don't pass allowedPathPrefixes (e.g.
        // BridgeSpike, the default WebViewHostScreen) must continue to
        // allow every `/m/*` path.
        final policy = NavigationPolicy(
          serverOrigin: Uri.parse('https://dev.example.com'),
        );
        expect(
          policy.decide(
            Uri.parse('https://dev.example.com/m/recording/abc'),
          ),
          NavigationDecision.allow,
        );
        expect(
          policy.decide(Uri.parse('https://dev.example.com/m/channel/c1')),
          NavigationDecision.allow,
        );
      },
    );
  });

  group('login policy (Add Server / re-auth)', () {
    final policy = NavigationPolicy.forLogin(
      serverOrigin: Uri.parse('https://dev.example.com'),
    );

    test('allows the server origin (any path, not just /m/)', () {
      expect(
        policy.decide(Uri.parse('https://dev.example.com/')),
        NavigationDecision.allow,
      );
      expect(
        policy.decide(Uri.parse('https://dev.example.com/login')),
        NavigationDecision.allow,
      );
    });

    test('allows Cloudflare Access challenge URLs', () {
      final uri = Uri.parse(
        'https://example.cloudflareaccess.com/cdn-cgi/access/login',
      );
      expect(policy.decide(uri), NavigationDecision.allow);
    });

    test('allows Google SSO', () {
      final uri = Uri.parse(
        'https://accounts.google.com/o/oauth2/auth?response_type=code',
      );
      expect(policy.decide(uri), NavigationDecision.allow);
    });

    test('allows Microsoft SSO (microsoftonline + live)', () {
      final ms = Uri.parse(
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      );
      expect(policy.decide(ms), NavigationDecision.allow);
      expect(
        policy.decide(Uri.parse('https://login.live.com/oauth20_authorize.srf')),
        NavigationDecision.allow,
      );
    });

    test('allows Okta (any subdomain)', () {
      expect(
        policy.decide(Uri.parse('https://myco.okta.com/login/sso_iwa_auth')),
        NavigationDecision.allow,
      );
    });

    test('still intercepts random external URLs externally', () {
      expect(
        policy.decide(Uri.parse('https://example.com/')),
        NavigationDecision.interceptAndOpenExternally,
      );
    });
  });
}
