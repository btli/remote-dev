import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../application/ports/secure_storage_port.dart';

class FlutterSecureStoragePort implements SecureStoragePort {
  FlutterSecureStoragePort([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.first_unlock_this_device,
              ),
            );

  final FlutterSecureStorage _storage;

  String _key(String serverId, String key) => 'server.$serverId.$key';

  @override
  Future<String?> read(String serverId, String key) =>
      _storage.read(key: _key(serverId, key));

  @override
  Future<void> write(String serverId, String key, String value) =>
      _storage.write(key: _key(serverId, key), value: value);

  @override
  Future<void> delete(String serverId, String key) =>
      _storage.delete(key: _key(serverId, key));

  @override
  Future<void> deleteAll(String serverId) async {
    final all = await _storage.readAll();
    final prefix = 'server.$serverId.';
    for (final key in all.keys.where((k) => k.startsWith(prefix))) {
      await _storage.delete(key: key);
    }
  }
}
