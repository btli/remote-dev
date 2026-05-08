abstract class ApiClientPort {
  /// GET an arbitrary path on the active server with cookie auth.
  Future<dynamic> get(String path);
}
