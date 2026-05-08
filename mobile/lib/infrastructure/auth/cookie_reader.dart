import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import '../../application/ports/cookie_reader_port.dart';
import '../../application/ports/secure_storage_port.dart';

/// Bridges the WebView's CookieManager → flutter_secure_storage so Dio
/// (which has its own independent cookie jar) can read the same value.
///
/// Spec §3:
/// - On iOS WKWebView, getCookies is async via WKHTTPCookieStore. There
///   are documented timing flakes on iOS 14 and below where the store
///   isn't immediately populated post-onLoadStop. We retry with backoff.
/// - HttpOnly cookies ARE accessible via WKHTTPCookieStore from native
///   code (only JS is blocked).
class CookieReader implements CookieReaderPort {
  CookieReader({
    required this.storage,
    CookieManager? cookieManager,
  }) : _cookieManager = cookieManager ?? CookieManager.instance();

  final SecureStoragePort storage;
  final CookieManager _cookieManager;

  static const _retryDelays = [
    Duration(milliseconds: 200),
    Duration(milliseconds: 400),
    Duration(milliseconds: 800),
  ];

  @override
  Future<String?> readCookie({
    required String origin,
    required String name,
  }) async {
    final url = WebUri(origin);
    for (final delay in _retryDelays) {
      final cookies = await _cookieManager.getCookies(url: url);
      for (final cookie in cookies) {
        if (cookie.name == name) {
          final value = cookie.value;
          if (value is String && value.isNotEmpty) return value;
        }
      }
      await Future<void>.delayed(delay);
    }
    return null;
  }

  /// Read CF_Authorization for a given server and persist it under that
  /// server's secure-storage namespace. Returns true on success.
  Future<bool> captureCfAuthorization({
    required String serverId,
    required Uri serverOrigin,
  }) async {
    final value = await readCookie(
      origin: serverOrigin.toString(),
      name: 'CF_Authorization',
    );
    if (value == null) return false;
    await storage.write(serverId, 'cf_authorization', value);
    return true;
  }
}
