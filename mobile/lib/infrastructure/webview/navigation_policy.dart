enum NavigationDecision { allow, interceptAndOpenExternally, intercept }

class NavigationPolicy {
  /// Default policy used by the in-session WebView (Phase 2). Locks the
  /// WebView to `<serverOrigin>/m/*` plus the CF Access challenge — every
  /// other URL is intercepted and opened externally.
  const NavigationPolicy({required this.serverOrigin})
      : _allowSsoProviders = false;

  /// Relaxed policy used during the Add Server / re-auth flow. Allows the
  /// well-known third-party identity providers that CF Access redirects to
  /// (Google, Microsoft, Okta), in addition to the server origin (any path,
  /// not just `/m/*`) and CF Access itself.
  ///
  /// We don't use this on the live session view because terminal output
  /// could legitimately contain a `https://accounts.google.com/...` link
  /// that we'd then accidentally load in-place.
  const NavigationPolicy.forLogin({required this.serverOrigin})
      : _allowSsoProviders = true;

  final Uri serverOrigin;
  final bool _allowSsoProviders;

  NavigationDecision decide(Uri uri) {
    if (_isCfAccessChallenge(uri)) return NavigationDecision.allow;
    if (_allowSsoProviders && _isSsoProvider(uri)) {
      return NavigationDecision.allow;
    }
    if (uri.origin != serverOrigin.origin) {
      return NavigationDecision.interceptAndOpenExternally;
    }
    if (_allowSsoProviders) {
      // Login flow: any path on the server origin is fair game (the form
      // post lands on `/`, not `/m/*`).
      return NavigationDecision.allow;
    }
    if (!uri.path.startsWith('/m/')) {
      return NavigationDecision.intercept;
    }
    return NavigationDecision.allow;
  }

  static bool _isCfAccessChallenge(Uri uri) {
    final host = uri.host.toLowerCase();
    return host.endsWith('.cloudflareaccess.com') ||
        host == 'cloudflareaccess.com';
  }

  /// Hosts that CF Access commonly federates to. Kept narrow so we don't
  /// accidentally turn the WebView into an open browser.
  static bool _isSsoProvider(Uri uri) {
    final host = uri.host.toLowerCase();
    return host == 'accounts.google.com' ||
        host == 'login.microsoftonline.com' ||
        host == 'login.live.com' ||
        host == 'okta.com' ||
        host.endsWith('.okta.com');
  }
}
