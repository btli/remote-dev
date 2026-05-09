abstract class ApiClientPort {
  /// GET an arbitrary path on the active server with cookie auth.
  Future<dynamic> get(String path);

  /// POST to a path with optional JSON body.
  Future<dynamic> post(String path, {Map<String, dynamic>? body});

  /// DELETE a path.
  Future<void> delete(String path);
}
