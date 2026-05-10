import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Monotonically-increasing counter that fires whenever the API layer
/// detects an unauthenticated response (HTTP 401/403) and needs the UI
/// to drive the user back through the CF Access challenge.
///
/// One-shot semantics: each call to [request] bumps the value, so a
/// `ref.listen` consumer can react to every event (not just transitions
/// from `false` → `true`). The UI listens at app shell level and routes
/// to `/reauth` on change.
class ReauthSignal extends StateNotifier<int> {
  ReauthSignal() : super(0);

  /// Notify listeners that re-authentication is required. Safe to call
  /// from any thread/zone — the underlying StateNotifier dispatches on
  /// the framework's microtask queue.
  void request() => state = state + 1;
}

/// App-wide signal the [CfAuthInterceptor] fires on 401/403.
///
/// Consumers (typically the router shell) should `ref.listen` and call
/// `context.go('/reauth')` on change. The signal value itself is opaque;
/// only the change matters.
final reauthSignalProvider =
    StateNotifierProvider<ReauthSignal, int>((ref) => ReauthSignal());
