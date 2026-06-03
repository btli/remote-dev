/// Joins a host origin + workspace basePath with a path. Single source of
/// truth for path-prefixed (multi-workspace) URL construction across the
/// Dio client, the WebView URL builders, and external navigation.
///
/// For a migrated single-workspace install [basePath] is `''`, so both
/// [api] and [web] are byte-identical to the pre-base-path behaviour.
class WorkspaceUrls {
  final String origin; // e.g. https://h  (no trailing slash)
  final String basePath; // '' or '/demo'
  const WorkspaceUrls(this.origin, this.basePath);

  /// For a Dio request path (Dio baseUrl is `origin`): '/demo' + '/api/x'
  /// -> '/demo/api/x'. With an empty basePath this returns the path
  /// unchanged (modulo a guaranteed leading slash).
  String api(String p) => '$basePath${_lead(p)}';

  /// Full URL for a WebView/external nav: 'https://h' + '/demo' + '/m/x'
  /// -> 'https://h/demo/m/x'. With an empty basePath this is exactly
  /// `origin + path`.
  String web(String p) => '$origin$basePath${_lead(p)}';

  static String _lead(String p) => p.startsWith('/') ? p : '/$p';
}
