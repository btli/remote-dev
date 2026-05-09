import '../../presentation/router/app_route.dart';

/// Translates incoming deep-link URIs into [AppRoute] values.
///
/// Pure-function — no I/O, no side effects. Easy to unit-test.
class DeepLinkRouter {
  /// Translate a deep-link URI into an [AppRoute], or `null` if the URI
  /// doesn't match any known surface.
  ///
  /// Accepts both:
  ///   - `remotedev://<surface>/<id?>` (custom scheme)
  ///   - `https://<server>/m/<surface>/<id?>` (Universal/App Links)
  ///
  /// Surfaces:
  ///   - `session/<id>`       → [SessionRoute]
  ///   - `channel/<id>`       → [ChannelRoute]
  ///   - `recording/<id>`     → [RecordingRoute]
  ///   - `notifications`      → [NotificationsRoute]
  ///   - `home`               → [HomeRoute]
  static AppRoute? routeFor(Uri uri) {
    // For custom-scheme URIs the host is the surface name and any path
    // segments are the rest. For https URIs the path is /m/<surface>/<id>.
    final List<String> parts;
    if (uri.scheme == 'remotedev') {
      parts = <String>[uri.host, ...uri.pathSegments]
          .where((s) => s.isNotEmpty)
          .toList();
    } else {
      var segs = uri.pathSegments.where((s) => s.isNotEmpty).toList();
      if (segs.isNotEmpty && segs.first == 'm') {
        segs = segs.sublist(1);
      }
      parts = segs;
    }

    if (parts.isEmpty) return null;
    final surface = parts.first;
    final id = parts.length > 1 ? parts[1] : null;

    switch (surface) {
      case 'session':
        if (id != null && id.isNotEmpty) return AppRoute.session(id);
        return null;
      case 'channel':
        if (id != null && id.isNotEmpty) return AppRoute.channel(id);
        return null;
      case 'recording':
        if (id != null && id.isNotEmpty) return AppRoute.recording(id);
        return null;
      case 'notifications':
        return const AppRoute.notifications();
      case 'home':
        return const AppRoute.home();
      default:
        return null;
    }
  }
}
