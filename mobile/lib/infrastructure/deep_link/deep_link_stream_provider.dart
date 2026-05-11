import 'package:app_links/app_links.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Single source-of-truth [AppLinks] instance. Creating two of these in a
/// process can cause the second listener to silently miss links on some
/// platforms — the cold-start initial-link is consumed by whichever
/// instance starts first.
final appLinksProvider = Provider<AppLinks>((_) => AppLinks());

/// Broadcast stream of every incoming deep-link URI for the app.
///
/// Backed by the single [AppLinks] instance from [appLinksProvider]. The
/// `uriLinkStream` from app_links is already a broadcast stream, so we
/// can hand it out to multiple subscribers — `AppLinkListener` (for
/// route dispatch) and `MobileCallbackLoginLauncher` (for the auth
/// callback) — without one starving the other.
final deepLinkStreamProvider = Provider<Stream<Uri>>((ref) {
  final links = ref.watch(appLinksProvider);
  return links.uriLinkStream;
});
