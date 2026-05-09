import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';

import '../../presentation/router/app_router.dart';
import 'deep_link_router.dart';

/// Listens to incoming deep-links from the [AppLinks] plugin and dispatches
/// matching [AppRoute] values via [AppRouter.navigateTo].
///
/// Lifecycle:
///   - [start]: fetch the initial link (cold-start) and subscribe to the
///     uri-link stream (warm-start).
///   - [stop]: cancel the stream subscription.
class AppLinkListener {
  AppLinkListener({required this.router, AppLinks? links})
      : _links = links ?? AppLinks();

  final AppRouter router;
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
    _sub = _links.uriLinkStream.listen(
      _navigate,
      onError: (Object e) {
        debugPrint('[DeepLink] uriLinkStream error: $e');
      },
    );
  }

  void _navigate(Uri uri) {
    final route = DeepLinkRouter.routeFor(uri);
    if (route != null) {
      router.navigateTo(route);
    } else {
      debugPrint('[DeepLink] no route for $uri');
    }
  }

  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
  }
}
