import 'package:flutter/material.dart';

/// Overlay shown when an agent process exits.
///
/// Mirrors the web app's AgentExitScreen.tsx — shows exit code
/// interpretation and restart/close actions.
class AgentExitOverlay extends StatefulWidget {
  const AgentExitOverlay({
    super.key,
    required this.exitCode,
    required this.onRestart,
    required this.onClose,
  });

  final int? exitCode;
  final VoidCallback onRestart;
  final Future<void> Function() onClose;

  @override
  State<AgentExitOverlay> createState() => _AgentExitOverlayState();
}

class _AgentExitOverlayState extends State<AgentExitOverlay> {
  bool _closing = false;

  String get _exitMessage => switch (widget.exitCode) {
        0 => 'Agent completed successfully',
        130 => 'Agent interrupted (Ctrl+C)',
        137 => 'Agent killed (out of memory)',
        _ => 'Agent exited with code ${widget.exitCode ?? 'unknown'}',
      };

  IconData get _exitIcon => switch (widget.exitCode) {
        0 => Icons.check_circle_outline,
        130 => Icons.cancel_outlined,
        137 => Icons.memory_outlined,
        _ => Icons.error_outline,
      };

  Future<void> _handleClose() async {
    setState(() => _closing = true);
    await widget.onClose();
    if (mounted) setState(() => _closing = false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      color: theme.scaffoldBackgroundColor.withValues(alpha: 0.9),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              _exitIcon,
              size: 48,
              color: widget.exitCode == 0
                  ? theme.colorScheme.primary
                  : theme.colorScheme.error,
            ),
            const SizedBox(height: 16),
            Text(
              _exitMessage,
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                FilledButton.icon(
                  onPressed: _closing ? null : widget.onRestart,
                  icon: const Icon(Icons.replay),
                  label: const Text('Restart'),
                ),
                const SizedBox(width: 12),
                OutlinedButton.icon(
                  onPressed: _closing ? null : _handleClose,
                  icon: _closing
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.close),
                  label: const Text('Close'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
