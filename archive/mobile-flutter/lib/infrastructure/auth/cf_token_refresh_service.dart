import 'dart:async';

import 'package:url_launcher/url_launcher.dart';

/// Handles automatic CF Access token refresh when the JWT expires.
///
/// Opens the CF Access login page in an external browser and waits for
/// the deep link callback (`remotedev://auth/callback`) with fresh
/// credentials. Deduplicates concurrent refresh requests so only one
/// browser window opens at a time.
class CfTokenRefreshService {
  CfTokenRefreshService({
    required this.serverUrl,
    required this.onCredentialsRefreshed,
  });

  /// Base URL of the Remote Dev server (e.g. `https://dev.example.com`).
  final String serverUrl;

  /// Called with fresh credentials after a successful re-authentication.
  /// The implementation should persist these to scoped storage.
  final Future<void> Function(String apiKey, String? cfToken)
      onCredentialsRefreshed;

  Completer<bool>? _activeRefresh;

  /// Guards against a new browser opening immediately after a refresh
  /// completes, before all concurrent retry callers have resolved.
  DateTime? _lastRefreshAt;

  /// Whether a refresh is currently in progress.
  bool get isRefreshing =>
      _activeRefresh != null && !_activeRefresh!.isCompleted;

  /// Trigger CF Access re-authentication via the browser.
  ///
  /// Returns `true` if the refresh succeeded and credentials were updated,
  /// `false` if it failed or timed out. If a refresh is already in progress,
  /// the caller awaits the existing attempt rather than opening a second
  /// browser window.
  Future<bool> refresh() async {
    // Deduplicate: if already refreshing, piggyback on the existing attempt.
    if (isRefreshing) return _activeRefresh!.future;

    // If a refresh just completed within the last 5 seconds, assume
    // credentials are fresh. This prevents a burst of concurrent 302
    // responses from each opening a new browser window after the first
    // refresh finishes and clears _activeRefresh.
    if (_lastRefreshAt != null &&
        DateTime.now().difference(_lastRefreshAt!) <
            const Duration(seconds: 5)) {
      return true;
    }

    final completer = Completer<bool>();
    _activeRefresh = completer;

    try {
      // Open the same mobile callback URL used for initial login.
      // CF Access will intercept if needed, then the server redirects
      // back to remotedev://auth/callback with fresh credentials.
      final callbackUrl = Uri.parse('$serverUrl/auth/mobile-callback');
      final launched = await launchUrl(
        callbackUrl,
        mode: LaunchMode.externalApplication,
      );

      if (!launched) {
        _complete(completer, false);
        return false;
      }

      // Wait for handleDeepLink() to be called by the global deep link
      // listener. Timeout after 2 minutes to avoid hanging indefinitely.
      final result = await completer.future.timeout(
        const Duration(minutes: 2),
        onTimeout: () {
          _complete(completer, false);
          return false;
        },
      );

      if (result) _lastRefreshAt = DateTime.now();
      return result;
    } catch (_) {
      _complete(completer, false);
      return false;
    } finally {
      // Only clear if this is still our completer (not replaced by another
      // refresh cycle that somehow started).
      if (_activeRefresh == completer) {
        _activeRefresh = null;
      }
    }
  }

  /// Called by the global deep link handler when a `remotedev://auth/callback`
  /// URI arrives while a refresh is in progress.
  ///
  /// Extracts the new credentials from query parameters and persists them
  /// via [onCredentialsRefreshed], then completes the pending [refresh] future.
  Future<void> handleDeepLink(Uri uri) async {
    final apiKey = uri.queryParameters['apiKey'];
    final cfToken = uri.queryParameters['cfToken'];
    final completer = _activeRefresh;

    if (apiKey != null && apiKey.isNotEmpty) {
      await onCredentialsRefreshed(apiKey, cfToken);
      _complete(completer, true);
    } else {
      _complete(completer, false);
    }
  }

  /// Cancel any in-progress refresh attempt.
  void dispose() {
    final completer = _activeRefresh;
    _activeRefresh = null;
    _complete(completer, false);
  }

  /// Safely completes a [completer] if it is still pending.
  ///
  /// Does not touch [_activeRefresh] -- cleanup is the responsibility
  /// of the [refresh] method's `finally` block, ensuring that
  /// deduplication waiters always receive their result before the
  /// completer reference is cleared.
  void _complete(Completer<bool>? completer, bool result) {
    if (completer != null && !completer.isCompleted) {
      completer.complete(result);
    }
  }
}
