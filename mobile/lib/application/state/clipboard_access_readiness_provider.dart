import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Fail-closed, process-local gate for native clipboard access.
///
/// The biometric lock overlay owns this state. It becomes true only while the
/// app is foregrounded and biometric policy has resolved to unlocked. It is
/// intentionally not persisted: every process start and lifecycle transition
/// must prove readiness again.
class ClipboardAccessReadinessNotifier extends StateNotifier<bool> {
  ClipboardAccessReadinessNotifier() : super(false);

  void markReady() => state = true;

  void markUnavailable() => state = false;
}

final clipboardAccessReadyProvider =
    StateNotifierProvider<ClipboardAccessReadinessNotifier, bool>(
      (ref) => ClipboardAccessReadinessNotifier(),
    );
