import 'package:flutter/material.dart';

import 'package:remote_dev/domain/entities/server_config.dart';
import 'package:remote_dev/domain/value_objects/auth_method.dart';

/// A card widget for displaying a server in the server list.
///
/// Shows server name, URL, auth method indicator, and connection status.
/// Highlights the active server with a primary border.
class ServerCard extends StatelessWidget {
  const ServerCard({
    super.key,
    required this.server,
    required this.isActive,
    required this.onTap,
    this.onLongPress,
    this.isConnected = false,
  });

  final ServerConfig server;
  final bool isActive;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  final bool isConnected;

  IconData get _authIcon => switch (server.authMethod) {
        CfAccessAuth() => Icons.cloud_rounded,
        ApiKeyAuth() => Icons.key_rounded,
        QrScannedAuth() => Icons.qr_code_rounded,
      };

  String get _authLabel => switch (server.authMethod) {
        CfAccessAuth() => 'Cloudflare',
        ApiKeyAuth() => 'API Key',
        QrScannedAuth() => 'QR Code',
      };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: isActive
            ? BorderSide(color: colorScheme.primary, width: 1.5)
            : BorderSide(color: colorScheme.outlineVariant),
      ),
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              // Connection status dot
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isConnected
                      ? colorScheme.primary
                      : colorScheme.outlineVariant,
                ),
              ),
              const SizedBox(width: 12),

              // Server info
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      server.displayName,
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      Uri.parse(server.serverUrl).host,
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontFamily: 'JetBrainsMono Nerd Font',
                        color: colorScheme.onSurfaceVariant,
                        fontSize: 11,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),

              // Auth method chip
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: colorScheme.surfaceContainerHigh,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      _authIcon,
                      size: 14,
                      color: colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      _authLabel,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),

              if (isActive) ...[
                const SizedBox(width: 8),
                Icon(
                  Icons.check_circle_rounded,
                  size: 20,
                  color: colorScheme.primary,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
