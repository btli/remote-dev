import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import 'package:remote_dev/domain/entities/server_config.dart';
import 'package:remote_dev/domain/value_objects/auth_method.dart';
import 'package:remote_dev/infrastructure/storage/server_scoped_storage.dart';
import 'package:remote_dev/presentation/providers/server_config_providers.dart';
import 'package:remote_dev/presentation/screens/server/qr_scan_screen.dart';
import 'package:remote_dev/presentation/widgets/server/host_input.dart';
import 'package:remote_dev/presentation/widgets/server/port_stepper.dart';
import 'package:remote_dev/presentation/widgets/server/protocol_dropdown.dart';

/// Add server screen with QR scan hero + manual setup fallback.
///
/// QR payload format (JSON):
/// ```json
/// {
///   "url": "https://dev.example.com",
///   "port": "6002",
///   "apiKey": "rdv_...",
///   "userId": "...",
///   "email": "user@example.com"
/// }
/// ```
class AddServerScreen extends ConsumerStatefulWidget {
  const AddServerScreen({super.key});

  @override
  ConsumerState<AddServerScreen> createState() => _AddServerScreenState();
}

class _AddServerScreenState extends ConsumerState<AddServerScreen> {
  bool _showManualForm = false;

  // Manual form state
  String _protocol = 'https://';
  final _hostController = TextEditingController();
  int _port = 6001;
  int _terminalPort = 6002;
  String _authMethod = 'cloudflare';
  final _apiKeyController = TextEditingController();
  final _nicknameController = TextEditingController();

  late final List<String> _recentHosts = _buildRecentHosts();

  @override
  void dispose() {
    _hostController.dispose();
    _apiKeyController.dispose();
    _nicknameController.dispose();
    super.dispose();
  }

  /// Extract unique hostnames from existing server configurations.
  List<String> _buildRecentHosts() {
    final servers = ref.read(serverListProvider);
    return servers
        .map((s) => Uri.tryParse(s.serverUrl)?.host)
        .whereType<String>()
        .toSet()
        .toList();
  }

  Future<void> _handleQrScan() async {
    final result = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const QrScanScreen()),
    );
    if (result != null && mounted) {
      await _handleQrPayload(result);
    }
  }

  Future<void> _handleQrPayload(String payload) async {
    try {
      final data = jsonDecode(payload) as Map<String, dynamic>;
      final serverUrl = data['url'] as String;
      final port = data['port'] as String? ?? '6002';
      final apiKey = data['apiKey'] as String;
      final userId = data['userId'] as String?;
      final email = data['email'] as String?;

      final config = ServerConfig(
        id: const Uuid().v4(),
        nickname: Uri.parse(serverUrl).host,
        serverUrl: serverUrl,
        terminalPort: port,
        authMethod: QrScannedAuth(scannedAt: DateTime.now()),
        createdAt: DateTime.now(),
        lastConnectedAt: DateTime.now(),
      );

      // Store credentials first — if this fails, no server config is orphaned
      final scopedStorage = ServerScopedStorage(
        storage: ref.read(secureStorageProvider),
        serverId: config.id,
      );
      await scopedStorage.storeCredentials(
        apiKey: apiKey,
        userId: userId ?? '',
        email: email ?? '',
      );

      await _saveAndActivate(config);

      if (mounted) {
        HapticFeedback.heavyImpact();
        context.go('/sessions');
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Invalid QR code: $e')),
        );
      }
    }
  }

  Future<void> _saveManualServer() async {
    final host = _hostController.text.trim();
    if (host.isEmpty) return;

    final serverUrl = '$_protocol$host:$_port';
    final authMethod =
        _authMethod == 'cloudflare' ? const CfAccessAuth() : const ApiKeyAuth();

    final config = ServerConfig(
      id: const Uuid().v4(),
      nickname: _nicknameController.text.trim(),
      serverUrl: serverUrl,
      terminalPort: _terminalPort.toString(),
      authMethod: authMethod,
      createdAt: DateTime.now(),
      lastConnectedAt: DateTime.now(),
    );

    await _saveAndActivate(config);

    if (_authMethod == 'apikey' && _apiKeyController.text.isNotEmpty) {
      final scopedStorage = ServerScopedStorage(
        storage: ref.read(secureStorageProvider),
        serverId: config.id,
      );
      await scopedStorage.setApiKey(_apiKeyController.text.trim());
    }

    if (mounted) {
      HapticFeedback.heavyImpact();
      if (_authMethod == 'cloudflare') {
        context.go('/login');
      } else {
        context.go('/sessions');
      }
    }
  }

  /// Persist the server config, set it as active, and refresh providers.
  Future<void> _saveAndActivate(ServerConfig config) async {
    final store = ref.read(serverConfigStoreProvider);
    await store.save(config);
    await store.setActiveServerId(config.id);
    ref.invalidate(serverListProvider);
    ref.read(activeServerIdProvider.notifier).state = config.id;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      backgroundColor: colorScheme.surface,
      appBar: AppBar(
        title: const Text('Add Server'),
        backgroundColor: colorScheme.surface,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // QR Scan Hero
              if (!_showManualForm) ...[
                const SizedBox(height: 32),
                Icon(
                  Icons.qr_code_scanner_rounded,
                  size: 80,
                  color: colorScheme.primary,
                ),
                const SizedBox(height: 24),
                Text(
                  'Scan QR Code',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  'Open your Remote Dev web dashboard\nand scan the connection QR code',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                FilledButton.icon(
                  onPressed: _handleQrScan,
                  icon: const Icon(Icons.camera_alt_rounded),
                  label: const Text('Open Scanner'),
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 32,
                      vertical: 16,
                    ),
                  ),
                ),
                const SizedBox(height: 48),
                Row(
                  children: [
                    Expanded(child: Divider(color: colorScheme.outlineVariant)),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Text(
                        'or',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                    Expanded(child: Divider(color: colorScheme.outlineVariant)),
                  ],
                ),
                const SizedBox(height: 16),
                OutlinedButton(
                  onPressed: () => setState(() => _showManualForm = true),
                  child: const Text('Manual Setup'),
                ),
              ],

              // Manual Setup Form
              if (_showManualForm) ...[
                // Nickname (optional)
                TextField(
                  controller: _nicknameController,
                  decoration: const InputDecoration(
                    labelText: 'Server Name (optional)',
                    hintText: 'Home Lab, Office, etc.',
                  ),
                  textCapitalization: TextCapitalization.words,
                ),
                const SizedBox(height: 20),

                // Protocol + Host
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    SizedBox(
                      width: 120,
                      child: ProtocolDropdown(
                        value: _protocol,
                        onChanged: (v) => setState(() => _protocol = v),
                        label: 'Protocol',
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: HostInput(
                        controller: _hostController,
                        recentHosts: _recentHosts,
                        label: 'Host',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 20),

                // Port
                PortStepper(
                  value: _port,
                  onChanged: (v) => setState(() => _port = v),
                  label: 'API Port',
                ),
                const SizedBox(height: 20),

                // Auth Method
                Text(
                  'Authentication',
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 8),
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(
                      value: 'cloudflare',
                      label: Text('Cloudflare'),
                      icon: Icon(Icons.cloud_rounded, size: 18),
                    ),
                    ButtonSegment(
                      value: 'apikey',
                      label: Text('API Key'),
                      icon: Icon(Icons.key_rounded, size: 18),
                    ),
                  ],
                  selected: {_authMethod},
                  onSelectionChanged: (v) {
                    setState(() => _authMethod = v.first);
                  },
                ),
                const SizedBox(height: 20),

                // API Key field (only for API key auth)
                if (_authMethod == 'apikey') ...[
                  TextField(
                    controller: _apiKeyController,
                    decoration: const InputDecoration(
                      labelText: 'API Key',
                      hintText: 'rdv_...',
                    ),
                    obscureText: true,
                    autocorrect: false,
                    enableSuggestions: false,
                  ),
                  const SizedBox(height: 20),
                ],

                // Terminal port (only for direct connections, not Cloudflare)
                if (_authMethod != 'cloudflare') ...[
                  PortStepper(
                    value: _terminalPort,
                    onChanged: (v) => setState(() => _terminalPort = v),
                    label: 'Terminal Port',
                  ),
                  const SizedBox(height: 20),
                ],

                const SizedBox(height: 8),
                FilledButton(
                  onPressed: _saveManualServer,
                  child: const Text('Connect'),
                ),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: () => setState(() => _showManualForm = false),
                  child: const Text('Back to QR Scan'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
