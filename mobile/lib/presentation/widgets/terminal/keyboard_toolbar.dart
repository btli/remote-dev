import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Mobile keyboard toolbar with special terminal keys.
///
/// Renders above the system keyboard with ESC, CTRL, ALT, TAB, arrows,
/// and common terminal symbols. Matches the web app's MobileKeyboard.tsx.
class KeyboardToolbar extends StatefulWidget {
  const KeyboardToolbar({
    super.key,
    required this.onKey,
  });

  /// Callback that sends raw escape sequences to the terminal.
  final void Function(String sequence) onKey;

  @override
  State<KeyboardToolbar> createState() => _KeyboardToolbarState();
}

class _KeyboardToolbarState extends State<KeyboardToolbar> {
  bool _ctrlActive = false;
  bool _altActive = false;

  void _handleKey(String key, {bool isModifier = false}) {
    HapticFeedback.selectionClick();

    if (isModifier) {
      setState(() {
        if (key == 'ctrl') _ctrlActive = !_ctrlActive;
        if (key == 'alt') _altActive = !_altActive;
      });
      return;
    }

    // Apply modifiers
    var sequence = key;
    if (_ctrlActive && key.length == 1) {
      // Convert to control character: Ctrl+A = 0x01, Ctrl+C = 0x03, etc.
      final code = key.toUpperCase().codeUnitAt(0) - 64;
      if (code >= 1 && code <= 26) {
        sequence = String.fromCharCode(code);
      }
    }
    if (_altActive) {
      sequence = '\x1b$sequence';
    }

    widget.onKey(sequence);

    // Reset modifiers after keypress
    if (_ctrlActive || _altActive) {
      setState(() {
        _ctrlActive = false;
        _altActive = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final toolbarBg = theme.scaffoldBackgroundColor.withValues(alpha: 0.95);

    return Container(
      decoration: BoxDecoration(
        color: toolbarBg,
        border: Border(
          top: BorderSide(
            color: theme.dividerColor.withValues(alpha: 0.2),
          ),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Row 1: Special keys
            _buildRow([
              _ToolbarKey('ESC', '\x1b'),
              _ToolbarKey('TAB', '\t'),
              _ToolbarKey(
                'CTRL',
                'ctrl',
                isModifier: true,
                isActive: _ctrlActive,
              ),
              _ToolbarKey(
                'ALT',
                'alt',
                isModifier: true,
                isActive: _altActive,
              ),
              _ToolbarKey('\u2191', '\x1b[A'),
              _ToolbarKey('\u2193', '\x1b[B'),
              _ToolbarKey('\u2190', '\x1b[D'),
              _ToolbarKey('\u2192', '\x1b[C'),
            ]),
            // Row 2: Common symbols
            _buildRow([
              _ToolbarKey('|', '|'),
              _ToolbarKey('/', '/'),
              _ToolbarKey('~', '~'),
              _ToolbarKey('-', '-'),
              _ToolbarKey('_', '_'),
              _ToolbarKey(':', ':'),
              _ToolbarKey('[', '['),
              _ToolbarKey(']', ']'),
            ]),
          ],
        ),
      ),
    );
  }

  Widget _buildRow(List<_ToolbarKey> keys) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      child: Row(
        children: keys
            .map(
              (key) => Expanded(
                child: _KeyButton(
                  label: key.label,
                  isActive: key.isActive,
                  onTap: () => _handleKey(
                    key.sequence,
                    isModifier: key.isModifier,
                  ),
                ),
              ),
            )
            .toList(),
      ),
    );
  }
}

class _ToolbarKey {
  const _ToolbarKey(
    this.label,
    this.sequence, {
    this.isModifier = false,
    this.isActive = false,
  });

  final String label;
  final String sequence;
  final bool isModifier;
  final bool isActive;
}

class _KeyButton extends StatelessWidget {
  const _KeyButton({
    required this.label,
    required this.onTap,
    this.isActive = false,
  });

  final String label;
  final VoidCallback onTap;
  final bool isActive;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.all(1.5),
      child: Material(
        color: isActive
            ? theme.colorScheme.primary.withValues(alpha: 0.3)
            : theme.colorScheme.surface.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap: onTap,
          child: Container(
            height: 36,
            alignment: Alignment.center,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: isActive ? FontWeight.bold : FontWeight.w500,
                color: isActive
                    ? theme.colorScheme.primary
                    : theme.colorScheme.onSurface.withValues(alpha: 0.8),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
