import 'package:flutter/foundation.dart';

enum LatchState { off, single, locked }

class ModifierLatch extends ChangeNotifier {
  ModifierLatch();

  final Map<String, LatchState> _state = {
    'ctrl': LatchState.off,
    'alt': LatchState.off,
    'shift': LatchState.off,
    'meta': LatchState.off,
  };

  LatchState stateOf(String mod) => _state[mod] ?? LatchState.off;

  Map<String, bool> snapshot() => {
        for (final entry in _state.entries)
          if (entry.value != LatchState.off) entry.key: true,
      };

  /// Tap a modifier key. Cycles off → single → locked → off.
  void tap(String mod) {
    final current = _state[mod] ?? LatchState.off;
    switch (current) {
      case LatchState.off:
        _state[mod] = LatchState.single;
      case LatchState.single:
        _state[mod] = LatchState.locked;
      case LatchState.locked:
        _state[mod] = LatchState.off;
    }
    notifyListeners();
  }

  /// Consume any single-shot modifiers after a non-modifier key was sent.
  /// Locked modifiers stay locked.
  void consumeSingles() {
    var changed = false;
    for (final mod in _state.keys.toList()) {
      if (_state[mod] == LatchState.single) {
        _state[mod] = LatchState.off;
        changed = true;
      }
    }
    if (changed) notifyListeners();
  }

  void reset() {
    final hadAny = _state.values.any((s) => s != LatchState.off);
    for (final mod in _state.keys.toList()) {
      _state[mod] = LatchState.off;
    }
    if (hadAny) notifyListeners();
  }
}
