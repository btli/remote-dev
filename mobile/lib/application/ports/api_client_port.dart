abstract class ApiClientPort {
  /// GET an arbitrary path on the active server with cookie auth.
  Future<dynamic> get(String path);

  /// POST to a path with optional JSON body.
  Future<dynamic> post(String path, {Map<String, dynamic>? body});

  /// PATCH a path with optional JSON body.
  Future<dynamic> patch(String path, {Map<String, dynamic>? body});

  /// DELETE a path, optionally with a JSON body. The body is only used by
  /// endpoints that accept bulk-payload semantics on DELETE (e.g.
  /// `/api/notifications` with `{ids: [...]}` instead of `/:id`).
  Future<void> delete(String path, {Map<String, dynamic>? body});
}
