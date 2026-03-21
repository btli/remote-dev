import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/application/ports/terminal_gateway.dart';
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
  bool _connected = false;
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
    if (manager == null || _connected) return;

    final config = ref.read(serverConfigProvider).valueOrNull;
    final client = ref.read(remoteDevClientProvider);
    final storage = ref.read(secureStorageProvider);
    if (config == null || client == null) return;

    final session = ref.read(activeSessionProvider);

    try {
      final tokenData = await client.getSessionToken(widget.sessionId);
      final token = tokenData['token'] as String;
      final cfToken = await storage.getCfToken();

      await manager.connect(
        TerminalConnectionParams(
          wsUrl: config.wsUrl,
          token: token,
          sessionId: widget.sessionId,
          tmuxSessionName: session?.tmuxSessionName ?? '',
          terminalType: session?.terminalType.value ?? 'shell',
          cfToken: cfToken,
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

  void _onNotificationDismissed(List<String> ids, bool all) {
    final pushService = ref.read(pushNotificationServiceProvider);
    pushService?.handleDismissed(ids: ids, all: all);
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
    final fontFamily = ref.watch(terminalFontProvider);
    final fontSize = ref.watch(terminalFontSizeProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          session?.name ?? 'Terminal',
          style: const TextStyle(fontSize: 16),
        ),
        actions: [
          if (session != null && session.isActive)
            MenuAnchor(
              builder: (context, controller, child) => IconButton(
                icon: const Icon(Icons.more_vert),
                onPressed: () {
                  if (controller.isOpen) {
                    controller.close();
                  } else {
                    controller.open();
                  }
                },
                tooltip: 'Actions',
              ),
              menuChildren: [
                MenuItemButton(
                  leadingIcon: const Icon(Icons.pause_circle_outline),
                  onPressed: _suspendSession,
                  child: const Text('Suspend'),
                ),
                MenuItemButton(
                  leadingIcon: const Icon(Icons.close),
                  onPressed: _closeSession,
                  child: const Text('Close'),
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
                  fontFamily: fontFamily,
                  fontSize: fontSize,
                  onAgentExited: _onAgentExited,
                  onNotificationDismissed: _onNotificationDismissed,
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
