import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
///
/// Uses `readOnly: true` on [xterm.TerminalView] so that the system keyboard
/// is driven by a native [TextField] instead of xterm's internal input handler.
/// This enables OS-level features like voice dictation, autocorrect, and
/// predictive text that xterm's custom input handling blocks.
class TerminalWidget extends StatefulWidget {
  const TerminalWidget({
    super.key,
    required this.gateway,
    required this.palette,
    this.fontFamily = 'JetBrainsMono Nerd Font',
    this.fontSize = 14.0,
    this.showKeyboardToolbar = true,
    this.onAgentExited,
    this.onAgentStatusChanged,
    this.onConnectionStatusChanged,
    this.onNotificationDismissed,
    this.onImageUpload,
    this.terminalFocusNode,
    this.isAgentSession = false,
  });

  final TerminalGateway gateway;
  final TerminalPalette palette;
  final String fontFamily;
  final double fontSize;
  final bool showKeyboardToolbar;
  final void Function(int? exitCode)? onAgentExited;
  final void Function(String sessionId, String status)? onAgentStatusChanged;
  final void Function(ConnectionStatus status)? onConnectionStatusChanged;
  final void Function(List<String> ids, bool all)? onNotificationDismissed;
  final Future<void> Function(Uint8List bytes, String mimeType)? onImageUpload;
  final FocusNode? terminalFocusNode;

  /// Whether this is an agent session (affects input bar placeholder text).
  final bool isAgentSession;

  @override
  State<TerminalWidget> createState() => _TerminalWidgetState();
}

class _TerminalWidgetState extends State<TerminalWidget>
    with WidgetsBindingObserver {
  late final xterm.Terminal _terminal;
  late FocusNode _terminalFocus;
  bool _ownsFocusNode = false;
  StreamSubscription<TerminalEvent>? _eventSub;
  StreamSubscription<ConnectionStatus>? _statusSub;
  ConnectionStatus _connectionStatus = ConnectionStatus.disconnected;

  /// Focus node for the native text input bar.
  final _inputFocus = FocusNode();

  // Track terminal dimensions for resize events
  int _lastCols = 0;
  int _lastRows = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _ownsFocusNode = widget.terminalFocusNode == null;
    _terminalFocus = widget.terminalFocusNode ?? FocusNode();

    _terminal = xterm.Terminal(
      maxLines: 50000, // Match server's tmux history-limit
    );

    // Subscribe to domain events from the gateway
    _eventSub = widget.gateway.events.listen(_onTerminalEvent);
    _statusSub =
        widget.gateway.connectionStatus.listen(_onConnectionStatusChanged);

    // Forward resize events to the gateway
    _terminal.onResize = (cols, rows, _, __) {
      _onResize(cols, rows);
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
      case NotificationReceived():
        break;
      case AgentStatusChanged(:final sessionId, :final status):
        widget.onAgentStatusChanged?.call(sessionId, status);
      case NotificationDismissed(:final ids, :final all):
        widget.onNotificationDismissed?.call(ids, all);
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
    _inputFocus.dispose();
    if (_ownsFocusNode) _terminalFocus.dispose();
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

        // Terminal view — readOnly so the system keyboard is driven by our
        // native TextField below instead of xterm's internal input handler.
        Expanded(
          child: GestureDetector(
            onTap: () => _inputFocus.requestFocus(),
            child: xterm.TerminalView(
              _terminal,
              theme: xtermTheme,
              textStyle: xterm.TerminalStyle(
                fontSize: widget.fontSize,
                fontFamily: widget.fontFamily,
              ),
              focusNode: _terminalFocus,
              readOnly: true,
              autofocus: false,
            ),
          ),
        ),

        // Native text input bar — enables voice dictation, autocorrect,
        // and predictive text from the OS keyboard.
        _InputBar(
          focusNode: _inputFocus,
          onSubmit: (text) => widget.gateway.sendInput(text),
          disabled: _connectionStatus != ConnectionStatus.connected,
          isAgentSession: widget.isAgentSession,
        ),

        // Mobile keyboard toolbar (special keys, modifiers, d-pad)
        if (widget.showKeyboardToolbar)
          KeyboardToolbar(
            onKey: (sequence) => widget.gateway.sendInput(sequence),
            onImageUpload: widget.onImageUpload,
            terminalFocusNode: _inputFocus,
          ),
      ],
    );
  }
}

/// Native text input bar for mobile terminal sessions.
///
/// Uses a standard [TextField] instead of xterm's internal input handler,
/// enabling OS-level voice dictation, autocorrect, and predictive text.
/// Mirrors the web app's MobileInputBar component.
///
/// - Send mode (default): tap sends text + "\r" (empty tap sends bare "\r")
/// - Type mode: tap sends text without "\r" (empty tap does nothing)
/// - Long-press send button: toggles between Send and Type mode
/// - Auto-expands up to 4 lines
class _InputBar extends StatefulWidget {
  const _InputBar({
    required this.focusNode,
    required this.onSubmit,
    this.disabled = false,
    this.isAgentSession = false,
  });

  final FocusNode focusNode;
  final void Function(String data) onSubmit;
  final bool disabled;
  final bool isAgentSession;

  @override
  State<_InputBar> createState() => _InputBarState();
}

class _InputBarState extends State<_InputBar> {
  final _controller = TextEditingController();
  bool _hasText = false;
  bool _typeMode = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onTextChanged);
  }

  @override
  void dispose() {
    _controller.removeListener(_onTextChanged);
    _controller.dispose();
    super.dispose();
  }

  void _onTextChanged() {
    final hasText = _controller.text.isNotEmpty;
    if (hasText != _hasText) {
      setState(() => _hasText = hasText);
    }
  }

  void _submit() {
    if (widget.disabled) return;
    final text = _controller.text;

    if (_typeMode) {
      // Type mode: send text only (no \r), do nothing if empty
      if (text.isEmpty) return;
      widget.onSubmit(text);
    } else {
      // Send mode: send text + \r (original behavior)
      widget.onSubmit(text.isNotEmpty ? '$text\r' : '\r');
    }

    _controller.clear();
  }

  /// Long-press: toggle between Send mode and Type mode.
  void _toggleTypeMode() {
    HapticFeedback.mediumImpact();
    setState(() => _typeMode = !_typeMode);
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(
        SnackBar(
          content: Text(
            _typeMode
                ? 'Type mode — tap to insert text'
                : 'Send mode — tap to execute',
          ),
          duration: const Duration(seconds: 1),
          behavior: SnackBarBehavior.floating,
          margin: const EdgeInsets.only(bottom: 80, left: 16, right: 16),
        ),
      );
  }

  void _onChanged(String value) {
    // Intercept newline from the soft keyboard Enter key and treat it as
    // submit (matching the web MobileInputBar behavior).  With maxLines > 1,
    // Flutter shows a newline key instead of a send key, so onSubmitted never
    // fires — we detect the trailing newline here instead.
    if (value.endsWith('\n')) {
      _controller.text = value.substring(0, value.length - 1);
      _controller.selection = TextSelection.collapsed(
        offset: _controller.text.length,
      );
      _submit();
    }
  }

  Widget _buildSendButton(ColorScheme colorScheme) {
    final Color iconColor;
    if (!_hasText) {
      iconColor = colorScheme.onSurface.withValues(alpha: 0.4);
    } else if (_typeMode) {
      iconColor = colorScheme.tertiary;
    } else {
      iconColor = colorScheme.primary;
    }

    return GestureDetector(
      onTap: widget.disabled ? null : _submit,
      onLongPress: widget.disabled ? null : _toggleTypeMode,
      child: Tooltip(
        message: _typeMode
            ? 'Type mode (hold for send mode)'
            : 'Send (hold for type mode)',
        triggerMode: TooltipTriggerMode.manual,
        child: SizedBox(
          width: 40,
          height: 40,
          child: Icon(
            _typeMode ? Icons.keyboard_rounded : Icons.send_rounded,
            size: 20,
            color: iconColor,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final borderRadius = BorderRadius.circular(12);
    final placeholder = widget.isAgentSession
        ? 'Ask the agent...'
        : 'Type a command...';

    // Safe area bottom padding when keyboard is hidden (home indicator).
    final bottomPadding = MediaQuery.of(context).viewInsets.bottom == 0
        ? MediaQuery.of(context).viewPadding.bottom
        : 0.0;

    return Container(
      decoration: BoxDecoration(
        color: theme.scaffoldBackgroundColor.withValues(alpha: 0.95),
        border: Border(
          top: BorderSide(
            color: theme.dividerColor.withValues(alpha: 0.2),
          ),
        ),
      ),
      padding: EdgeInsets.only(
        left: 8,
        right: 8,
        top: 6,
        bottom: 6 + bottomPadding,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: TextField(
              controller: _controller,
              focusNode: widget.focusNode,
              enabled: !widget.disabled,
              maxLines: 4,
              minLines: 1,
              textInputAction: TextInputAction.send,
              autocorrect: widget.isAgentSession,
              enableSuggestions: widget.isAgentSession,
              textCapitalization: widget.isAgentSession
                  ? TextCapitalization.sentences
                  : TextCapitalization.none,
              style: TextStyle(
                fontSize: 14,
                color: colorScheme.onSurface,
              ),
              decoration: InputDecoration(
                hintText: placeholder,
                hintStyle: TextStyle(
                  fontSize: 14,
                  color: colorScheme.onSurface.withValues(alpha: 0.4),
                ),
                filled: true,
                fillColor: colorScheme.surfaceContainerHigh
                    .withValues(alpha: 0.5),
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
                border: OutlineInputBorder(
                  borderRadius: borderRadius,
                  borderSide: BorderSide.none,
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: borderRadius,
                  borderSide: BorderSide.none,
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: borderRadius,
                  borderSide: BorderSide(
                    color: colorScheme.primary.withValues(alpha: 0.5),
                  ),
                ),
                isDense: true,
              ),
              onChanged: _onChanged,
              onSubmitted: (_) => _submit(),
            ),
          ),

          const SizedBox(width: 6),

          // Send button — tap = send, long-press = toggle type/send mode
          _buildSendButton(colorScheme),
        ],
      ),
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
