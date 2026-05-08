/// How the user authenticates to a remote-dev server.
///
/// Credentials (API key, CF token) are stored in secure storage,
/// keyed by server ID. This sealed class only tracks the _method_,
/// not the credentials themselves.
sealed class AuthMethod {
  const AuthMethod();

  String get type;

  Map<String, dynamic> toJson();

  factory AuthMethod.fromJson(Map<String, dynamic> json) {
    return switch (json['type'] as String) {
      'cfAccess' => const CfAccessAuth(),
      'apiKey' => const ApiKeyAuth(),
      'qrScanned' => QrScannedAuth(
          scannedAt: DateTime.parse(json['scannedAt'] as String),
        ),
      _ => const ApiKeyAuth(),
    };
  }
}

/// Cloudflare Access authentication.
///
/// The user authenticates via browser → CF Access login → deep link callback.
/// Terminal port is irrelevant since everything goes through the CF tunnel.
final class CfAccessAuth extends AuthMethod {
  const CfAccessAuth();

  @override
  String get type => 'cfAccess';

  @override
  Map<String, dynamic> toJson() => {'type': type};
}

/// Direct API key authentication.
///
/// User manually enters the API key. Requires server URL and terminal port.
final class ApiKeyAuth extends AuthMethod {
  const ApiKeyAuth();

  @override
  String get type => 'apiKey';

  @override
  Map<String, dynamic> toJson() => {'type': type};
}

/// QR code scanned authentication.
///
/// Tracks when the QR was scanned for audit/display purposes.
/// The QR payload contains server URL + API key.
final class QrScannedAuth extends AuthMethod {
  const QrScannedAuth({required this.scannedAt});

  final DateTime scannedAt;

  @override
  String get type => 'qrScanned';

  @override
  Map<String, dynamic> toJson() => {
        'type': type,
        'scannedAt': scannedAt.toIso8601String(),
      };
}
