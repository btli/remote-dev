import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/application/ports/terminal_gateway.dart';
import 'package:remote_dev/domain/value_objects/connection_status.dart';
import 'package:remote_dev/presentation/providers/providers.dart';
import 'package:remote_dev/presentation/widgets/terminal/agent_exit_overlay.dart';
import 'package:remote_dev/presentation/widgets/terminal/terminal_widget.dart';

/// Full-screen terminal for a single session.
class TerminalScreen extends ConsumerStatefulWidget {
  const TerminalScreen({super.key, required this.sessionId});

  final String sessionId;

  @override
  ConsumerState<TerminalScreen> createState() => _TerminalScreenState();
}

class _TerminalScreenState extends ConsumerState<TerminalScreen> {
  bool _connected = false;
  int? _agentExitCode;
  bool _agentExited = false;

  @override
  void initState() {
    super.initState();
    // Set active session
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(activeSessionIdProvider.notifier).state = widget.sessionId;
      _connectTerminal();
    });
  }

  Future<void> _connectTerminal() async {
    final manager = ref.read(terminalManagerProvider(widget.sessionId));
    if (manager == null || _connected) return;

    final config = ref.read(serverConfigProvider).valueOrNull;
    if (config == null) return;

    final session = ref.read(activeSessionProvider);
    final tmuxName = session?.tmuxSessionName ?? '';
    final terminalType = session?.terminalType.value ?? 'shell';

    try {
      final client = ref.read(remoteDevClientProvider);
      if (client == null) return;
      final tokenData = await client.getSessionToken(widget.sessionId);
      final token = tokenData['token'] as String;

      await manager.connect(
        TerminalConnectionParams(
          wsUrl: config.wsUrl,
          token: token,
          sessionId: widget.sessionId,
          tmuxSessionName: tmuxName,
          terminalType: terminalType,
        ),
      );

      if (mounted) setState(() => _connected = true);
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
    setState(() {
      _agentExited = false;
      _agentExitCode = null;
    });
  }

  Future<void> _suspendSession() async {
    await ref
        .read(sessionListProvider.notifier)
        .suspendSession(widget.sessionId);
    if (mounted) Navigator.of(context).maybePop();
  }

  Future<void> _closeSession() async {
    await ref
        .read(sessionListProvider.notifier)
        .closeSession(widget.sessionId);
    if (mounted) Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(activeSessionProvider);
    final manager = ref.watch(terminalManagerProvider(widget.sessionId));
    final palette = ref.watch(terminalPaletteProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          session?.name ?? 'Terminal',
          style: const TextStyle(fontSize: 16),
        ),
        actions: [
          if (session != null && session.isActive)
            PopupMenuButton<String>(
              onSelected: (value) {
                switch (value) {
                  case 'suspend':
                    _suspendSession();
                  case 'close':
                    _closeSession();
                }
              },
              itemBuilder: (context) => [
                const PopupMenuItem(
                  value: 'suspend',
                  child: ListTile(
                    leading: Icon(Icons.pause_circle_outline),
                    title: Text('Suspend'),
                    dense: true,
                  ),
                ),
                const PopupMenuItem(
                  value: 'close',
                  child: ListTile(
                    leading: Icon(Icons.close),
                    title: Text('Close'),
                    dense: true,
                  ),
                ),
              ],
            ),
        ],
      ),
      body: manager == null
          ? const Center(child: Text('Not connected'))
          : Stack(
              children: [
                TerminalWidget(
                  gateway: manager,
                  palette: palette,
                  onAgentExited: _onAgentExited,
                  onConnectionStatusChanged: (status) {
                    if (status == ConnectionStatus.connected && !_connected) {
                      setState(() => _connected = true);
                    }
                  },
                ),
                if (_agentExited)
                  AgentExitOverlay(
                    exitCode: _agentExitCode,
                    onRestart: _onRestartAgent,
                    onClose: () => Navigator.of(context).maybePop(),
                  ),
              ],
            ),
    );
  }
}
