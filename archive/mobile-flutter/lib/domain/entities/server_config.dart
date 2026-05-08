import 'package:remote_dev/domain/value_objects/auth_method.dart';

/// A saved remote-dev server configuration.
///
/// Each server has its own URL, auth method, and credentials.
/// Credentials (API key, CF token) are stored separately in
/// [ServerScopedStorage], keyed by [id].
class ServerConfig {
  final String id;
  final String nickname;
  final String serverUrl;
  final String terminalPort;
  final AuthMethod authMethod;
  final DateTime createdAt;
  final DateTime lastConnectedAt;
  final int sortOrder;

  const ServerConfig({
    required this.id,
    required this.nickname,
    required this.serverUrl,
    this.terminalPort = '6002',
    required this.authMethod,
    required this.createdAt,
    required this.lastConnectedAt,
    this.sortOrder = 0,
  });

  /// Display name: nickname if set, otherwise extracted hostname.
  String get displayName {
    if (nickname.isNotEmpty) return nickname;
    final uri = Uri.tryParse(serverUrl);
    return uri?.host ?? serverUrl;
  }

  /// Whether this server uses Cloudflare Access (port is irrelevant).
  bool get isCfAccess => authMethod is CfAccessAuth;

  /// WebSocket URL for the terminal server.
  String get wsUrl {
    final uri = Uri.parse(serverUrl);
    final wsScheme = uri.scheme == 'https' ? 'wss' : 'ws';
    // For CF Access, terminal goes through the same host (reverse proxy).
    // For direct connections, use the terminal port.
    if (isCfAccess) {
      return '$wsScheme://${uri.host}/ws';
    }
    return '$wsScheme://${uri.host}:$terminalPort/ws';
  }

  ServerConfig copyWith({
    String? nickname,
    String? serverUrl,
    String? terminalPort,
    AuthMethod? authMethod,
    DateTime? lastConnectedAt,
    int? sortOrder,
  }) {
    return ServerConfig(
      id: id,
      nickname: nickname ?? this.nickname,
      serverUrl: serverUrl ?? this.serverUrl,
      terminalPort: terminalPort ?? this.terminalPort,
      authMethod: authMethod ?? this.authMethod,
      createdAt: createdAt,
      lastConnectedAt: lastConnectedAt ?? this.lastConnectedAt,
      sortOrder: sortOrder ?? this.sortOrder,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'nickname': nickname,
        'serverUrl': serverUrl,
        'terminalPort': terminalPort,
        'authMethod': authMethod.toJson(),
        'createdAt': createdAt.toIso8601String(),
        'lastConnectedAt': lastConnectedAt.toIso8601String(),
        'sortOrder': sortOrder,
      };

  factory ServerConfig.fromJson(Map<String, dynamic> json) => ServerConfig(
        id: json['id'] as String,
        nickname: json['nickname'] as String? ?? '',
        serverUrl: json['serverUrl'] as String,
        terminalPort: json['terminalPort'] as String? ?? '6002',
        authMethod: AuthMethod.fromJson(
          json['authMethod'] as Map<String, dynamic>,
        ),
        createdAt: DateTime.parse(json['createdAt'] as String),
        lastConnectedAt: DateTime.parse(json['lastConnectedAt'] as String),
        sortOrder: json['sortOrder'] as int? ?? 0,
      );
}
