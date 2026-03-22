import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

/// Mobile keyboard toolbar with special terminal keys.
///
/// Two modes (Keys/Nav) matching the web app's MobileKeyboard.tsx.
/// Supports sticky CTRL/ALT/SHIFT modifiers, quick keys, navigation
/// keys, and optional camera/image upload.
class KeyboardToolbar extends StatefulWidget {
  const KeyboardToolbar({
    super.key,
    required this.onKey,
    this.onImageUpload,
    this.terminalFocusNode,
  });

  /// Callback that sends raw escape sequences to the terminal.
  final void Function(String sequence) onKey;

  /// Optional image upload callback. When non-null, shows camera button.
  /// Receives raw bytes and MIME type; parent handles the upload.
  final Future<void> Function(Uint8List bytes, String mimeType)? onImageUpload;

  /// Optional focus node to return focus to the terminal after key press.
  final FocusNode? terminalFocusNode;

  @override
  State<KeyboardToolbar> createState() => _KeyboardToolbarState();
}

enum _KeyboardMode { keys, nav }

class _ToolbarKey {
  const _ToolbarKey(this.label, this.sequence, {this.isModifier = false});
  final String label;
  final String sequence;
  final bool isModifier;
}

// ── Shared keys ────────────────────────────────────────────────────────
const _kEsc = _ToolbarKey('ESC', '\x1b');
const _kCtrlC = _ToolbarKey('^C', '\x03');
const _kCtrlD = _ToolbarKey('^D', '\x04');
const _kTab = _ToolbarKey('TAB', '\t');
const _kCtrl = _ToolbarKey('CTRL', 'ctrl', isModifier: true);
const _kAlt = _ToolbarKey('ALT', 'alt', isModifier: true);
const _kShift = _ToolbarKey('SHIFT', 'shift', isModifier: true);

// ── Keys mode ──────────────────────────────────────────────────────────
const _keysRow1 = [_kEsc, _kCtrlC, _kCtrlD, _kTab, _kCtrl, _kAlt, _kShift];
const _keysRow2 = [
  _ToolbarKey('|', '|'),
  _ToolbarKey('/', '/'),
  _ToolbarKey('~', '~'),
  _ToolbarKey('-', '-'),
  _ToolbarKey('_', '_'),
  _ToolbarKey(':', ':'),
];

// ── Nav mode ───────────────────────────────────────────────────────────
const _navDpadUp = _ToolbarKey('\u2191', '\x1b[A');
const _navDpadDown = _ToolbarKey('\u2193', '\x1b[B');
const _navDpadLeft = _ToolbarKey('\u2190', '\x1b[D');
const _navDpadRight = _ToolbarKey('\u2192', '\x1b[C');

const _navRow1 = [
  _ToolbarKey('HOME', '\x1b[H'),
  _ToolbarKey('END', '\x1b[F'),
  _ToolbarKey('ENTER', '\r'),
  _ToolbarKey('\u21e7\u21b5', '\x1b\r'),
  _kCtrl,
  _kAlt,
  _kShift,
];
const _navRow2 = [
  _kEsc,
  _kCtrlC,
  _kCtrlD,
  _ToolbarKey('PGUP', '\x1b[5~'),
  _ToolbarKey('PGDN', '\x1b[6~'),
];

class _KeyboardToolbarState extends State<KeyboardToolbar>
    with WidgetsBindingObserver {
  _KeyboardMode _mode = _KeyboardMode.keys;
  bool _ctrlActive = false;
  bool _altActive = false;
  bool _shiftActive = false;
  bool _isUploading = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if ((state == AppLifecycleState.paused ||
            state == AppLifecycleState.detached) &&
        mounted) {
      _clearModifiers();
    }
  }

  void _toggleMode() {
    HapticFeedback.selectionClick();
    setState(() {
      _mode = _mode == _KeyboardMode.keys
          ? _KeyboardMode.nav
          : _KeyboardMode.keys;
      _ctrlActive = false;
      _altActive = false;
      _shiftActive = false;
    });
  }

  void _clearModifiers() {
    setState(() {
      _ctrlActive = false;
      _altActive = false;
      _shiftActive = false;
    });
  }

  /// Resolve a key through active modifiers. Pure computation — no state mutation.
  String _resolveSequence(String key) {
    // Pre-composed sequences (arrows, HOME, PGUP, etc.) and control characters
    // skip modifier resolution — they are already fully formed.
    if (key.length > 1 || key.codeUnitAt(0) < 32) return key;

    var sequence = key;

    // Ctrl+key → control character (A-Z → 0x01-0x1A, @[\]^_ → 0x00-0x1F)
    if (_ctrlActive) {
      final charCode = sequence.toUpperCase().codeUnitAt(0);
      if (charCode >= 64 && charCode <= 95) {
        sequence = String.fromCharCode(charCode - 64);
      }
    }

    // Alt → ESC prefix
    if (_altActive) {
      sequence = '\x1b$sequence';
    }

    return sequence;
  }

  void _handleKey(_ToolbarKey key) {
    HapticFeedback.selectionClick();

    if (key.isModifier) {
      setState(() {
        switch (key.sequence) {
          case 'ctrl':
            _ctrlActive = !_ctrlActive;
          case 'alt':
            _altActive = !_altActive;
          case 'shift':
            _shiftActive = !_shiftActive;
        }
      });
      return;
    }

    final anyActive = _ctrlActive || _altActive || _shiftActive;
    final sequence = anyActive ? _resolveSequence(key.sequence) : key.sequence;
    widget.onKey(sequence);

    // Clear modifiers after sending (not inside _resolveSequence to avoid setState during build)
    if (anyActive) _clearModifiers();

    // Return focus to terminal
    widget.terminalFocusNode?.requestFocus();
  }

  Future<void> _handleCameraPress() async {
    final picker = ImagePicker();
    final XFile? file = await picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 90,
      maxWidth: 2048,
      maxHeight: 2048,
    );
    if (file == null || !mounted) return;

    setState(() => _isUploading = true);
    try {
      final bytes = await file.readAsBytes();
      final mimeType = _mimeFromExtension(file.path);
      await widget.onImageUpload!(bytes, mimeType);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Upload failed: $e'),
            duration: const Duration(seconds: 3),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  String _mimeFromExtension(String path) {
    final ext = path.split('.').last.toLowerCase();
    return const {
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'png': 'image/png',
          'gif': 'image/gif',
          'webp': 'image/webp',
          'heic': 'image/heic',
          'heif': 'image/heif',
        }[ext] ??
        'image/png';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final toolbarBg = theme.scaffoldBackgroundColor.withValues(alpha: 0.95);
    final isNav = _mode == _KeyboardMode.nav;
    final row1 = isNav ? _navRow1 : _keysRow1;
    final row2 = isNav ? _navRow2 : _keysRow2;

    // Bottom safe area only when keyboard is hidden
    final bottomPadding = MediaQuery.of(context).viewInsets.bottom == 0
        ? MediaQuery.of(context).viewPadding.bottom
        : 0.0;

    return Container(
      decoration: BoxDecoration(
        color: toolbarBg,
        border: Border(
          top: BorderSide(
            color: theme.dividerColor.withValues(alpha: 0.2),
          ),
        ),
      ),
      child: Padding(
        padding: EdgeInsets.only(
          left: 4,
          right: 4,
          top: 2,
          bottom: bottomPadding + 2,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            // D-pad in Nav mode
            if (isNav) ...[
              _buildDpad(),
              const SizedBox(width: 4),
            ],

            // Main key rows
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _buildRow(row1, trailing: _buildModeSwitchButton()),
                  const SizedBox(height: 3),
                  _buildRow(row2, trailing: _buildCameraButton()),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  bool _isModifierActive(_ToolbarKey key) {
    return switch (key.sequence) {
      'ctrl' => _ctrlActive,
      'alt' => _altActive,
      'shift' => _shiftActive,
      _ => false,
    };
  }

  Widget _buildDpad() {
    const size = 40.0; // Fixed touch target size for d-pad buttons
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        _DpadButton(
          label: _navDpadUp.label,
          size: size,
          onTap: () => _handleKey(_navDpadUp),
        ),
        const SizedBox(height: 2),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _DpadButton(
              label: _navDpadLeft.label,
              size: size,
              onTap: () => _handleKey(_navDpadLeft),
            ),
            const SizedBox(width: 2),
            _DpadButton(
              label: _navDpadDown.label,
              size: size,
              onTap: () => _handleKey(_navDpadDown),
            ),
            const SizedBox(width: 2),
            _DpadButton(
              label: _navDpadRight.label,
              size: size,
              onTap: () => _handleKey(_navDpadRight),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildModeSwitchButton() {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Material(
        color: theme.colorScheme.surface.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap: _toggleMode,
          child: Container(
            height: 36,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              border: Border.all(
                color: theme.dividerColor.withValues(alpha: 0.3),
              ),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              _mode == _KeyboardMode.keys ? 'NAV' : 'KEYS',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget? _buildCameraButton() {
    if (widget.onImageUpload == null) return null;
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Material(
        color: theme.colorScheme.surface.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap: _isUploading ? null : _handleCameraPress,
          child: Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            child: _isUploading
                ? SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color:
                          theme.colorScheme.onSurface.withValues(alpha: 0.6),
                    ),
                  )
                : Icon(
                    Icons.camera_alt_outlined,
                    size: 16,
                    color:
                        theme.colorScheme.onSurface.withValues(alpha: 0.6),
                  ),
          ),
        ),
      ),
    );
  }

  Widget _buildRow(List<_ToolbarKey> keys, {Widget? trailing}) {
    return Row(
      children: [
        for (final key in keys)
          Expanded(
            child: _KeyButton(
              label: key.label,
              isActive: _isModifierActive(key),
              onTap: () => _handleKey(key),
            ),
          ),
        if (trailing != null) trailing,
      ],
    );
  }
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

class _DpadButton extends StatelessWidget {
  const _DpadButton({
    required this.label,
    required this.size,
    required this.onTap,
  });

  final String label;
  final double size;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return SizedBox(
      width: size,
      height: size,
      child: Padding(
        padding: const EdgeInsets.all(1.5),
        child: Material(
          color: theme.colorScheme.surface.withValues(alpha: 0.6),
          borderRadius: BorderRadius.circular(6),
          child: InkWell(
            borderRadius: BorderRadius.circular(6),
            onTap: onTap,
            child: Center(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.8),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
