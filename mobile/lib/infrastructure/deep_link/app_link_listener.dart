import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';

import '../../presentation/router/app_router.dart';
import 'deep_link_router.dart';

/// Listens to incoming deep-links and dispatches matching [AppRoute]
/// values via [AppRouter.navigateDeepLink] (which roots `/home` then pushes
/// the target so the back button works on cold-start).
///
/// Lifecycle:
///   - [start]: fetch the initial link (cold-start) via [AppLinks] and
///     subscribe to the shared broadcast [linkStream] for warm-start
///     events.
///   - [stop]: cancel the stream subscription.
///
/// Why the stream is injected: the
/// `MobileCallbackLoginLauncher` also subscribes to the same
/// `AppLinks().uriLinkStream`. Having both wire up their own [AppLinks]
/// instance would cause the second listener to miss the initial link
/// and (on some platforms) duplicate warm-start emissions. Both share
/// the broadcast stream from `deepLinkStreamProvider`.
class AppLinkListener {
  AppLinkListener({
    required this.router,
    required this.linkStream,
    AppLinks? links,
  }) : _links = links ?? AppLinks();

  final AppRouter router;

  /// Shared broadcast stream of incoming URIs (from `deepLinkStreamProvider`).
  final Stream<Uri> linkStream;

  final AppLinks _links;
  StreamSubscription<Uri>? _sub;

  Future<void> start() async {
    try {
      final initial = await _links.getInitialLink();
      if (initial != null) {
        _navigate(initial);
      }
    } catch (e) {
      debugPrint('[DeepLink] getInitialLink failed: $e');
    }
    await _sub?.cancel();
    _sub = linkStream.listen(
      _navigate,
      onError: (Object e) {
        debugPrint('[DeepLink] uriLinkStream error: $e');
      },
    );
  }

  void _navigate(Uri uri) {
    // Auth-callback URIs are consumed by the in-flight
    // `MobileCallbackLoginLauncher` subscription — there is no app route
    // for them, and routing here would emit a misleading "no route for
    // ..." debug log. Skip them silently.
    if (uri.scheme == 'remotedev' &&
        uri.host == 'auth' &&
        uri.path == '/callback') {
      return;
    }
    final route = DeepLinkRouter.routeFor(uri);
    if (route != null) {
      // Use navigateDeepLink (root /home, then push) so back works when the
      // app is cold-started from an external link. navigateTo/go would
      // replace the stack and leave nothing to pop. navigateDeepLink no-ops
      // the extra push for the /home target.
      router.navigateDeepLink(route);
    } else {
      debugPrint('[DeepLink] no route for $uri');
    }
  }

  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
  }
}
