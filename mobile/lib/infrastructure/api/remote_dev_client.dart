import 'dart:typed_data';

import 'package:dio/dio.dart';

import 'package:remote_dev/domain/errors/app_error.dart';

/// Response from the folders endpoint containing both folders and
/// the session-to-folder mapping.
class FoldersResponse {
  const FoldersResponse({
    required this.folders,
    required this.sessionFolders,
  });

  /// List of raw folder JSON objects.
  final List<Map<String, dynamic>> folders;

  /// Mapping of session ID to folder ID.
  final Map<String, String> sessionFolders;
}

/// HTTP client for the Remote Dev REST API.
///
/// All methods return domain types. Auth is handled via a Bearer token
/// interceptor reading from [SecureStorageService].
class RemoteDevClient {
  RemoteDevClient({
    required Future<String?> Function() getApiKey,
    required Future<String?> Function() getCfToken,
    required String baseUrl,
    this.onTokenExpired,
  }) : _dio = Dio(
          BaseOptions(
            baseUrl: baseUrl,
            connectTimeout: const Duration(seconds: 10),
            receiveTimeout: const Duration(seconds: 30),
            headers: {'Content-Type': 'application/json'},
            followRedirects: false,
            validateStatus: (status) => status != null && status < 400,
          ),
        ) {
    _dio.interceptors.add(_AuthInterceptor(getApiKey, getCfToken));
  }

  final Dio _dio;

  /// Called when a CF Access token expiry is detected (302/303 redirect).
  /// Should trigger re-authentication and return `true` if new credentials
  /// were obtained, allowing the failed request to be retried automatically.
  final Future<bool> Function()? onTokenExpired;

  // ── Sessions ──────────────────────────────────────────────────────────

  Future<List<Map<String, dynamic>>> listSessions({
    String? status,
  }) async {
    final response = await _request(
      () => _dio.get(
        '/api/sessions',
        queryParameters: {
          if (status != null) 'status': status,
        },
      ),
    );
    final sessions = response['sessions'] as List? ?? [];
    return sessions.cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> createSession(
    Map<String, dynamic> input,
  ) async {
    return _request(() => _dio.post('/api/sessions', data: input));
  }

  Future<Map<String, dynamic>> getSession(String id) async {
    return _request(() => _dio.get('/api/sessions/$id'));
  }

  Future<void> suspendSession(String id) async {
    await _request(() => _dio.post('/api/sessions/$id/suspend'));
  }

  Future<void> resumeSession(String id) async {
    await _request(() => _dio.post('/api/sessions/$id/resume'));
  }

  Future<void> closeSession(String id) async {
    await _request(() => _dio.delete('/api/sessions/$id'));
  }

  Future<void> updateSession(String id, Map<String, dynamic> data) async {
    await _request(() => _dio.patch('/api/sessions/$id', data: data));
  }

  /// Get a WebSocket auth token for a session.
  /// Returns { token, sessionId, tmuxSessionName, expiresIn }.
  Future<Map<String, dynamic>> getSessionToken(String id) async {
    return _request(() => _dio.get('/api/sessions/$id/token'));
  }

  // ── Folders ───────────────────────────────────────────────────────────

  /// Returns both folders and the session-to-folder mapping.
  Future<FoldersResponse> listFolders() async {
    final response = await _request(() => _dio.get('/api/folders'));
    final folders =
        response['folders'] as List? ?? response['items'] as List? ?? [];
    final sessionFoldersRaw =
        response['sessionFolders'] as Map<String, dynamic>? ?? {};
    return FoldersResponse(
      folders: folders.cast<Map<String, dynamic>>(),
      sessionFolders: sessionFoldersRaw.map(
        (key, value) => MapEntry(key, value as String),
      ),
    );
  }

  Future<Map<String, dynamic>> createFolder(
    Map<String, dynamic> data,
  ) async {
    return _request(() => _dio.post('/api/folders', data: data));
  }

  Future<void> updateFolder(String id, Map<String, dynamic> data) async {
    await _request(() => _dio.patch('/api/folders/$id', data: data));
  }

  Future<void> deleteFolder(String id) async {
    await _request(() => _dio.delete('/api/folders/$id'));
  }

  // ── Preferences & Appearance ──────────────────────────────────────────

  Future<Map<String, dynamic>> getPreferences() async {
    return _request(() => _dio.get('/api/preferences'));
  }

  Future<Map<String, dynamic>> getProfileAppearance(String profileId) async {
    return _request(
      () => _dio.get('/api/profiles/$profileId/appearance'),
    );
  }

  // ── Notifications ─────────────────────────────────────────────────────

  Future<Map<String, dynamic>> listNotifications({int limit = 50}) async {
    return _request(
      () => _dio.get(
        '/api/notifications',
        queryParameters: {'limit': limit},
      ),
    );
  }

  Future<void> markNotificationsRead(List<String> ids) async {
    await _request(
      () => _dio.patch('/api/notifications', data: {'ids': ids}),
    );
  }

  Future<void> markAllNotificationsRead() async {
    await _request(
      () => _dio.patch('/api/notifications', data: {'all': true}),
    );
  }

  Future<void> deleteNotifications(List<String> ids) async {
    await _request(
      () => _dio.delete('/api/notifications', data: {'ids': ids}),
    );
  }

  Future<void> deleteAllNotifications() async {
    await _request(
      () => _dio.delete('/api/notifications', data: {'all': true}),
    );
  }

  // ── Push Tokens ──────────────────────────────────────────────────────

  Future<void> registerPushToken(
    String token,
    String platform,
    String? deviceId,
  ) async {
    await _request(
      () => _dio.post(
        '/api/notifications/push-token',
        data: {
          'token': token,
          'platform': platform,
          if (deviceId != null) 'deviceId': deviceId,
        },
      ),
    );
  }

  Future<void> unregisterPushToken(String token) async {
    await _request(
      () => _dio.delete(
        '/api/notifications/push-token',
        data: {'token': token},
      ),
    );
  }

  // ── Git ──────────────────────────────────────────────────────────────

  /// Validates a filesystem path as a git repository and returns local branches.
  Future<Map<String, dynamic>> validateGitPath(String path) async {
    return _request(
      () => _dio.get(
        '/api/git/validate',
        queryParameters: {'path': path},
      ),
    );
  }

  // ── Splits ────────────────────────────────────────────────────────────

  Future<List<Map<String, dynamic>>> listSplits() async {
    final response = await _request(() => _dio.get('/api/splits'));
    final splits =
        response['splits'] as List? ?? response['items'] as List? ?? [];
    return splits.cast<Map<String, dynamic>>();
  }

  // ── Auth ──────────────────────────────────────────────────────────────

  /// Exchange a CF Access token for an API key (mobile auth flow).
  Future<Map<String, dynamic>> exchangeMobileToken(String cfToken) async {
    return _request(
      () => _dio.post(
        '/api/auth/mobile-exchange',
        data: {'cfToken': cfToken},
      ),
    );
  }

  // ── Images ──────────────────────────────────────────────────────────

  /// Upload image bytes to the server. Returns the server-side file path.
  Future<String> uploadImage(Uint8List bytes, String mimeType) async {
    final ext = const {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
    }[mimeType] ??
        '.png';
    final fileName = 'image-${DateTime.now().millisecondsSinceEpoch}$ext';

    final formData = FormData.fromMap({
      'image': MultipartFile.fromBytes(
        bytes,
        filename: fileName,
        contentType: DioMediaType.parse(mimeType),
      ),
    });

    final response =
        await _request(() => _dio.post('/api/images', data: formData));
    final path = response['path'] as String?;
    if (path == null) {
      throw const ApiError(
        'No path in upload response',
        code: 'UPLOAD_ERROR',
        statusCode: 0,
      );
    }
    return path;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  /// Generic request wrapper that converts Dio exceptions to domain errors.
  ///
  /// Detects CF Access token expiry (302/303 redirects that pass
  /// `validateStatus`) and triggers automatic re-authentication via
  /// [onTokenExpired]. If the refresh succeeds, the original request is
  /// retried once with the new credentials.
  Future<Map<String, dynamic>> _request(
    Future<Response<dynamic>> Function() request,
  ) async {
    try {
      final response = await request();

      // CF Access redirects come back as 302/303 with followRedirects: false.
      // Since validateStatus allows < 400, these are "successful" responses
      // with non-JSON bodies. Detect and handle token refresh.
      if (!_isCfRedirect(response)) return _normalizeData(response.data);

      if (onTokenExpired != null && await onTokenExpired!()) {
        // Retry with fresh credentials (the _AuthInterceptor reads from
        // storage on each request, so the new token is picked up).
        final retryResponse = await request();
        if (_isCfRedirect(retryResponse)) _throwTokenExpired();
        return _normalizeData(retryResponse.data);
      }

      _throwTokenExpired();
    } on AppError {
      rethrow;
    } on DioException catch (e) {
      throw _mapDioError(e);
    }
  }

  static bool _isCfRedirect(Response<dynamic> response) {
    final status = response.statusCode;
    return status == 302 || status == 303;
  }

  static Map<String, dynamic> _normalizeData(dynamic data) {
    if (data is Map<String, dynamic>) return data;
    if (data is List) return {'items': data};
    return {};
  }

  static Never _throwTokenExpired() {
    throw const AuthError(
      'Session expired. Please sign in again.',
      code: 'CF_TOKEN_EXPIRED',
    );
  }

  AppError _mapDioError(DioException e) {
    final statusCode = e.response?.statusCode;
    final body = e.response?.data;
    final message = body is Map ? (body['error'] as String?) : null;

    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.connectionError) {
      return NetworkError(
        message ?? 'Connection failed: ${e.message}',
        code: 'NETWORK_ERROR',
      );
    }

    // CF Access redirects (302/303) indicate expired CF token
    if (statusCode == 302 || statusCode == 303) {
      return const AuthError(
        'Session expired. Please sign in again.',
        code: 'CF_TOKEN_EXPIRED',
      );
    }

    if (statusCode == 401 || statusCode == 403) {
      return AuthError(
        message ?? 'Authentication required',
        code: 'UNAUTHORIZED',
      );
    }

    if (statusCode == 404) {
      return NotFoundError(
        message ?? 'Resource not found',
        code: 'NOT_FOUND',
      );
    }

    return ApiError(
      message ?? 'Request failed: ${e.message}',
      code: 'API_ERROR',
      statusCode: statusCode ?? 0,
    );
  }
}

/// Dio interceptor that injects the Bearer API key and CF Access cookie.
class _AuthInterceptor extends Interceptor {
  _AuthInterceptor(this._getApiKey, this._getCfToken);
  final Future<String?> Function() _getApiKey;
  final Future<String?> Function() _getCfToken;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final apiKey = await _getApiKey();
    if (apiKey != null) {
      options.headers['Authorization'] = 'Bearer $apiKey';
    }
    final cfToken = await _getCfToken();
    if (cfToken != null) {
      options.headers['Cookie'] = 'CF_Authorization=$cfToken';
    }
    handler.next(options);
  }
}
