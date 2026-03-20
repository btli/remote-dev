import 'package:dio/dio.dart';

import 'package:remote_dev/domain/errors/app_error.dart';
import 'package:remote_dev/infrastructure/storage/secure_storage_service.dart';

/// HTTP client for the Remote Dev REST API.
///
/// All methods return domain types. Auth is handled via a Bearer token
/// interceptor reading from [SecureStorageService].
class RemoteDevClient {
  RemoteDevClient({
    required SecureStorageService storage,
    required String baseUrl,
  })  : _storage = storage,
        _dio = Dio(
          BaseOptions(
            baseUrl: baseUrl,
            connectTimeout: const Duration(seconds: 10),
            receiveTimeout: const Duration(seconds: 30),
            headers: {'Content-Type': 'application/json'},
          ),
        ) {
    _dio.interceptors.add(_AuthInterceptor(_storage));
  }

  final Dio _dio;
  final SecureStorageService _storage;

  // ── Sessions ──────────────────────────────────────────────────────────

  Future<List<Map<String, dynamic>>> listSessions({
    String? status,
  }) async {
    final queryParams = <String, dynamic>{};
    if (status != null) queryParams['status'] = status;
    final response = await _request(
      () => _dio.get('/api/sessions', queryParameters: queryParams),
    );
    // Backend wraps sessions: { sessions: [...] }
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

  Future<List<Map<String, dynamic>>> listFolders() async {
    final response = await _request(() => _dio.get('/api/folders'));
    final folders = response['folders'] as List? ??
        response['items'] as List? ??
        [];
    return folders.cast<Map<String, dynamic>>();
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

  Future<Map<String, dynamic>> getAppearance() async {
    return _request(() => _dio.get('/api/appearance'));
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

  // ── Splits ────────────────────────────────────────────────────────────

  Future<List<Map<String, dynamic>>> listSplits() async {
    final response = await _request(() => _dio.get('/api/splits'));
    final splits = response['splits'] as List? ??
        response['items'] as List? ??
        [];
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

  // ── Internal ──────────────────────────────────────────────────────────

  /// Generic request wrapper that converts Dio exceptions to domain errors.
  Future<Map<String, dynamic>> _request(
    Future<Response<dynamic>> Function() request,
  ) async {
    try {
      final response = await request();
      final data = response.data;
      if (data is Map<String, dynamic>) return data;
      if (data is List) return {'items': data};
      return {};
    } on DioException catch (e) {
      throw _mapDioError(e);
    }
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

/// Dio interceptor that injects the Bearer API key on every request.
class _AuthInterceptor extends Interceptor {
  _AuthInterceptor(this._storage);
  final SecureStorageService _storage;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final apiKey = await _storage.getApiKey();
    if (apiKey != null) {
      options.headers['Authorization'] = 'Bearer $apiKey';
    }
    handler.next(options);
  }
}
