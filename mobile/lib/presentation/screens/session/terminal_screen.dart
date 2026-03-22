import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:remote_dev/application/ports/terminal_gateway.dart';
import 'package:remote_dev/domain/value_objects/agent_provider.dart';
import 'package:remote_dev/presentation/providers/providers.dart';
import 'package:remote_dev/presentation/providers/push_notification_providers.dart';
import 'package:remote_dev/presentation/widgets/terminal/agent_exit_overlay.dart';
import 'package:remote_dev/presentation/widgets/terminal/terminal_widget.dart';

class TerminalScreen extends ConsumerStatefulWidget {
  const TerminalScreen({super.key, required this.sessionId});

  final String sessionId;

  @override
  ConsumerState<TerminalScreen> createState() => _TerminalScreenState();
}

class _TerminalScreenState extends ConsumerState<TerminalScreen> {
  int? _agentExitCode;
  bool _agentExited = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(activeSessionIdProvider.notifier).state = widget.sessionId;
      _connectTerminal();
    });
  }

  Future<void> _connectTerminal() async {
    final manager = ref.read(terminalManagerProvider(widget.sessionId));
    if (manager == null) return;

    final serverConfig = ref.read(activeServerConfigProvider);
    final client = ref.read(remoteDevClientProvider);
    final scopedStorage = ref.read(serverScopedStorageProvider);
    if (serverConfig == null || client == null) return;

    final session = ref.read(activeSessionProvider);

    try {
      final tokenData = await client.getSessionToken(widget.sessionId);
      if (!mounted) return;
      final token = tokenData['token'] as String;
      final cfToken = await scopedStorage?.getCfToken();
      if (!mounted) return;

      await manager.connect(
        TerminalConnectionParams(
          wsUrl: serverConfig.wsUrl,
          token: token,
          sessionId: widget.sessionId,
          tmuxSessionName: session?.tmuxSessionName ?? '',
          terminalType: session?.terminalType.value ?? 'shell',
          cfToken: cfToken,
        ),
      );
    } on Exception {
      // Connection error handled by the manager's reconnection logic
    }
  }

  void _onAgentExited(int? exitCode) {
    if (mounted) {
      setState(() {
        _agentExited = true;
        _agentExitCode = exitCode;
      });
    }
  }

  void _onRestartAgent() {
    final manager = ref.read(terminalManagerProvider(widget.sessionId));
    manager?.sendRestartAgent();
    if (mounted) {
      setState(() {
        _agentExited = false;
        _agentExitCode = null;
      });
    }
  }

  Future<void> _onImageUpload(Uint8List bytes, String mimeType) async {
    final client = ref.read(remoteDevClientProvider);
    if (client == null) return;
    final manager = ref.read(terminalManagerProvider(widget.sessionId));
    if (manager == null) return;

    final path = await client.uploadImage(bytes, mimeType);
    manager.sendInput(path);
  }

  void _onAgentStatusChanged(String sessionId, String status) {
    ref.read(sessionListProvider.notifier).updateAgentStatus(
          sessionId,
          AgentActivityStatus.fromString(status),
        );
  }

  void _onNotificationDismissed(List<String> ids, bool all) {
    final pushService = ref.read(pushNotificationServiceProvider);
    pushService?.handleDismissed(ids: ids, all: all);
  }

  void _navigateAway() {
    if (!mounted) return;
    ref.read(activeSessionIdProvider.notifier).state = null;
    context.go('/sessions');
  }

  @override
  Widget build(BuildContext context) {
    final manager = ref.watch(terminalManagerProvider(widget.sessionId));
    final palette = ref.watch(terminalPaletteProvider);
    final fontFamily = ref.watch(terminalFontProvider);
    final fontSize = ref.watch(terminalFontSizeProvider);

    if (manager == null) {
      return const Center(child: Text('Not connected'));
    }

    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) _navigateAway();
      },
      child: Stack(
        children: [
          TerminalWidget(
            gateway: manager,
            palette: palette,
            fontFamily: fontFamily,
            fontSize: fontSize,
            onAgentExited: _onAgentExited,
            onAgentStatusChanged: _onAgentStatusChanged,
            onNotificationDismissed: _onNotificationDismissed,
            onImageUpload: _onImageUpload,
          ),
          if (_agentExited)
            AgentExitOverlay(
              exitCode: _agentExitCode,
              onRestart: _onRestartAgent,
              onClose: _navigateAway,
            ),
        ],
      ),
    );
  }
}
