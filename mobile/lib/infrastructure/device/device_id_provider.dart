import 'package:uuid/uuid.dart';

import '../../application/ports/secure_storage_port.dart';

/// Test seam — see [DeviceIdProvider].
typedef IdGenerator = String Function();

String _defaultIdGenerator() => const Uuid().v4();

/// Provides a stable per-device UUID, persisted in secure storage.
///
/// The id is generated once on first call and reused thereafter so the
/// server can dedupe push subscriptions across token rotations and app
/// reinstalls (until secure storage is wiped).
///
/// Stored under the meta-namespace alongside other app-wide settings so it
/// is independent of any particular server registration.
class DeviceIdProvider {
  DeviceIdProvider(this._storage, {IdGenerator? idGenerator})
      : _idGenerator = idGenerator ?? _defaultIdGenerator;

  final SecureStoragePort _storage;
  final IdGenerator _idGenerator;

  static const _serverId = '__meta__';
  static const _key = 'device.id';

  /// Read the stable per-device UUID. Generates + persists on first call.
  Future<String> get() async {
    final existing = await _storage.read(_serverId, _key);
    if (existing != null && existing.isNotEmpty) return existing;
    final id = _idGenerator();
    await _storage.write(_serverId, _key, id);
    return id;
  }
}
