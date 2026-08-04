import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Stable device-local preference keys for clipboard synchronization.
class ClipboardSyncPrefsKeys {
  static const enabled = 'clipboard.syncEnabled';
}

/// Owns the device-local clipboard-sync opt-in.
///
/// Clipboard sync is deliberately disabled until the persisted preference is
/// hydrated or the user explicitly enables it. As with appearance settings, a
/// user change that races hydration wins over the stored value.
class ClipboardSyncNotifier extends StateNotifier<bool> {
  ClipboardSyncNotifier() : super(false) {
    _hydrate();
  }

  /// Test seam for deterministic SharedPreferences-backed state.
  ClipboardSyncNotifier.test(SharedPreferences prefs)
    : _prefs = prefs,
      _hydrated = true,
      super(prefs.getBool(ClipboardSyncPrefsKeys.enabled) ?? false);

  SharedPreferences? _prefs;
  bool _hydrated = false;
  bool _userTouched = false;

  bool get isHydrated => _hydrated;

  Future<void> _hydrate() async {
    final prefs = await SharedPreferences.getInstance();
    _prefs = prefs;
    if (_userTouched) {
      _hydrated = true;
      return;
    }
    if (mounted) {
      state = prefs.getBool(ClipboardSyncPrefsKeys.enabled) ?? false;
    }
    _hydrated = true;
  }

  Future<void> setEnabled(bool value) async {
    _userTouched = true;
    state = value;
    final prefs = _prefs ?? await SharedPreferences.getInstance();
    _prefs = prefs;
    await prefs.setBool(ClipboardSyncPrefsKeys.enabled, value);
  }
}

/// Device-local clipboard-sync opt-in. Defaults to false.
final clipboardSyncProvider =
    StateNotifierProvider<ClipboardSyncNotifier, bool>(
      (ref) => ClipboardSyncNotifier(),
    );
