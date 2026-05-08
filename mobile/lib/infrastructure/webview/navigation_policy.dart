enum NavigationDecision { allow, interceptAndOpenExternally, intercept }

class NavigationPolicy {
  const NavigationPolicy({required this.serverOrigin});

  final Uri serverOrigin;

  NavigationDecision decide(Uri uri) {
    if (_isCfAccessChallenge(uri)) return NavigationDecision.allow;
    if (uri.origin != serverOrigin.origin) {
      return NavigationDecision.interceptAndOpenExternally;
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
}
