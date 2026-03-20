import 'dart:async';

import 'package:flutter/material.dart';
import 'package:xterm/xterm.dart' as xterm;

import 'package:remote_dev/application/ports/terminal_gateway.dart';
import 'package:remote_dev/domain/events/terminal_event.dart';
import 'package:remote_dev/domain/value_objects/connection_status.dart';
import 'package:remote_dev/presentation/theme/oklch.dart';
import 'package:remote_dev/presentation/theme/terminal_theme.dart';
import 'package:remote_dev/presentation/widgets/terminal/keyboard_toolbar.dart';

/// Terminal emulator widget wrapping xterm.dart.
///
/// Connects to a [TerminalGateway], pipes output to the terminal
/// emulator, and sends user input back over the gateway.
class TerminalWidget extends StatefulWidget {
  const TerminalWidget({
    super.key,
    required this.gateway,
    required this.palette,
    this.fontFamily = 'JetBrainsMono Nerd Font',
    this.fontSize = 14.0,
    this.showKeyboardToolbar = true,
    this.onAgentExited,
    this.onConnectionStatusChanged,
  });

  final TerminalGateway gateway;
  final TerminalPalette palette;
  final String fontFamily;
  final double fontSize;
  final bool showKeyboardToolbar;
  final void Function(int? exitCode)? onAgentExited;
  final void Function(ConnectionStatus status)? onConnectionStatusChanged;

  @override
  State<TerminalWidget> createState() => _TerminalWidgetState();
}

class _TerminalWidgetState extends State<TerminalWidget>
    with WidgetsBindingObserver {
  late final xterm.Terminal _terminal;
  StreamSubscription<TerminalEvent>? _eventSub;
  StreamSubscription<ConnectionStatus>? _statusSub;
  ConnectionStatus _connectionStatus = ConnectionStatus.disconnected;

  // Track terminal dimensions for resize events
  int _lastCols = 0;
  int _lastRows = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    _terminal = xterm.Terminal(
      maxLines: 50000, // Match server's tmux history-limit
    );

    // Subscribe to domain events from the gateway
    _eventSub = widget.gateway.events.listen(_onTerminalEvent);
    _statusSub =
        widget.gateway.connectionStatus.listen(_onConnectionStatusChanged);

    // Forward user input to the gateway
    _terminal.onOutput = (data) {
      widget.gateway.sendInput(data);
    };
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Reconnect when app comes to foreground
    if (state == AppLifecycleState.resumed &&
        _connectionStatus != ConnectionStatus.connected) {
      widget.gateway.forceReconnect();
    }
  }

  void _onTerminalEvent(TerminalEvent event) {
    switch (event) {
      case TerminalOutput(:final data):
        _terminal.write(data);
      case AgentExited(:final exitCode):
        widget.onAgentExited?.call(exitCode);
      case TerminalExited():
        // Session ended
        break;
      case TerminalError(:final message):
        _terminal.write('\r\n\x1b[31mError: $message\x1b[0m\r\n');
      case TerminalReady():
      case AgentStatusChanged():
      case NotificationReceived():
        break;
    }
  }

  void _onConnectionStatusChanged(ConnectionStatus status) {
    setState(() => _connectionStatus = status);
    widget.onConnectionStatusChanged?.call(status);
  }

  void _onResize(int cols, int rows) {
    if (cols != _lastCols || rows != _lastRows) {
      _lastCols = cols;
      _lastRows = rows;
      widget.gateway.sendResize(cols, rows);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _eventSub?.cancel();
    _statusSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final xtermTheme = widget.palette.toXtermTheme();

    return Column(
      children: [
        // Connection status bar
        if (_connectionStatus == ConnectionStatus.reconnecting)
          _ConnectionBanner(
            message: 'Reconnecting...',
            color: hexToColor(widget.palette.yellow),
          ),
        if (_connectionStatus == ConnectionStatus.failed)
          _ConnectionBanner(
            message: 'Connection failed',
            color: hexToColor(widget.palette.red),
            action: TextButton(
              onPressed: () => widget.gateway.forceReconnect(),
              child: const Text('Retry'),
            ),
          ),

        // Terminal view
        Expanded(
          child: xterm.TerminalView(
            _terminal,
            theme: xtermTheme,
            textStyle: xterm.TerminalStyle(
              fontSize: widget.fontSize,
              fontFamily: widget.fontFamily,
            ),
            onResize: _onResize,
            autofocus: true,
          ),
        ),

        // Mobile keyboard toolbar
        if (widget.showKeyboardToolbar)
          KeyboardToolbar(
            onKey: (sequence) => widget.gateway.sendInput(sequence),
          ),
      ],
    );
  }
}

class _ConnectionBanner extends StatelessWidget {
  const _ConnectionBanner({
    required this.message,
    required this.color,
    this.action,
  });

  final String message;
  final Color color;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      color: color.withValues(alpha: 0.15),
      child: Row(
        children: [
          SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: color,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            message,
            style: TextStyle(fontSize: 12, color: color),
          ),
          const Spacer(),
          if (action != null) action!,
        ],
      ),
    );
  }
}
