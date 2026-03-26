import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Single global [AppLinks] subscription that broadcasts deep link URIs.
///
/// Only one platform channel listener should exist for deep links at a
/// time. This provider owns that listener and exposes a broadcast stream
/// so multiple consumers (login screen, token refresh, etc.) can all
/// receive every incoming URI without racing each other.
final deepLinkStreamProvider = Provider<Stream<Uri>>((ref) {
  final controller = StreamController<Uri>.broadcast();
  final appLinks = AppLinks();
  final sub = appLinks.uriLinkStream.listen(controller.add);

  ref.onDispose(() {
    sub.cancel();
    controller.close();
  });

  return controller.stream;
});
