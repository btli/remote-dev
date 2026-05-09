import 'dart:convert';

import '../../application/ports/secure_storage_port.dart';
import '../../domain/biometric_settings.dart';

/// Persists [BiometricSettings] in [SecureStoragePort] under the meta
/// namespace (server-agnostic — the lock applies to the whole app, not a
/// specific server).
class BiometricSettingsStore {
  BiometricSettingsStore(this._storage);

  final SecureStoragePort _storage;

  static const _serverId = '__meta__';
  static const _key = 'biometric_settings';

  /// Loads settings, or returns defaults if nothing has been stored.
  Future<BiometricSettings> load() async {
    final raw = await _storage.read(_serverId, _key);
    if (raw == null || raw.isEmpty) return const BiometricSettings();
    return BiometricSettings.fromJson(
      jsonDecode(raw) as Map<String, dynamic>,
    );
  }

  /// Persists the given settings. Overwrites any existing entry.
  Future<void> save(BiometricSettings settings) async {
    await _storage.write(_serverId, _key, jsonEncode(settings.toJson()));
  }
}
