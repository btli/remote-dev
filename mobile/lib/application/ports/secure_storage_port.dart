abstract class SecureStoragePort {
  /// Read the value at [key] for the given [serverId]. Returns null if absent.
  Future<String?> read(String serverId, String key);

  /// Write [value] at [key] for the given [serverId].
  Future<void> write(String serverId, String key, String value);

  /// Delete the entry at [key] for the given [serverId]. No-op if absent.
  Future<void> delete(String serverId, String key);

  /// Delete every key for [serverId] (used on sign-out / delete-server).
  Future<void> deleteAll(String serverId);
}
