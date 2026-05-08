import 'package:freezed_annotation/freezed_annotation.dart';

part 'server_config.freezed.dart';
part 'server_config.g.dart';

@freezed
class ServerConfig with _$ServerConfig {
  const factory ServerConfig({
    required String id,
    required String label,
    required String url,
    required DateTime lastUsedAt,
  }) = _ServerConfig;

  factory ServerConfig.fromJson(Map<String, dynamic> json) =>
      _$ServerConfigFromJson(json);
}
