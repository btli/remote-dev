abstract class CookieReaderPort {
  /// Read the named cookie for [origin] from the underlying WebView store.
  /// Returns null if not present.
  Future<String?> readCookie({
    required String origin,
    required String name,
  });
}
