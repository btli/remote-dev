import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import 'modifier_latch.dart';

/// Smart-key strip key dispatch.
///
/// `name` is the PWA-side key identifier the JS bridge expects (e.g.
/// `Tab`, `Escape`, `ArrowUp`, or a literal character like `|`). For
/// composed control bytes the strip pre-resolves the byte and calls
/// [onKeyPress] with `name = '__bytes__'` and the encoded sequence in
/// the `bytes` arg; the embedded view wires that to `bridge.input`.
typedef SmartKeyHandler = void Function(
  String name,
  Map<String, bool> mods, {
  String? bytes,
});

/// Optional image-upload handler. Receives raw image bytes + MIME type
/// (e.g. `image/jpeg`) and is expected to forward to the JS bridge's
/// `uploadImage(b64, mimeType)` call. Wired by the parent screen via
/// [BridgeController.uploadImage]; left optional so widget tests can
/// mount the strip without an image picker.
typedef SmartKeyImageHandler = FutureOr<void> Function(
  Uint8List bytes,
  String mimeType,
);

/// Mode toggle: control-keys vs nav-keys. Mirrors the PWA's
/// `KeyboardMode = "keys" | "nav"` in `MobileKeyboard.tsx`.
enum SmartKeyMode { keys, nav }

class SmartKeyStrip extends StatefulWidget {
  const SmartKeyStrip({
    required this.onKeyPress,
    this.onUploadImage,
    this.imagePicker,
    super.key,
  });

  final SmartKeyHandler onKeyPress;

  /// Optional callback for native image upload. When null, the image
  /// button is hidden.
  final SmartKeyImageHandler? onUploadImage;

  /// Injectable for tests; production uses `ImagePicker()` from the
  /// `image_picker` package. Kept as a `dynamic` to avoid binding the
  /// public API to the plugin's class hierarchy in widget tests.
  final ImagePicker? imagePicker;

  @override
  State<SmartKeyStrip> createState() => _SmartKeyStripState();
}

class _SmartKeyStripState extends State<SmartKeyStrip> {
  final ModifierLatch _latch = ModifierLatch();
  SmartKeyMode _mode = SmartKeyMode.keys;
  bool _uploading = false;

  late final ImagePicker _picker = widget.imagePicker ?? ImagePicker();

  @override
  void initState() {
    super.initState();
    _latch.addListener(_onLatchChange);
  }

  @override
  void dispose() {
    _latch.removeListener(_onLatchChange);
    _latch.dispose();
    super.dispose();
  }

  void _onLatchChange() => setState(() {});

  /// Press a key. [name] is the PWA bridge name; pass [bytes] when the
  /// strip wants to inject a raw sequence (e.g. `^C` = 0x03).
  void _press(String name, {bool isModifier = false, String? bytes}) {
    HapticFeedback.selectionClick();
    if (isModifier) {
      _latch.tap(name);
      return;
    }
    final mods = _latch.snapshot();
    widget.onKeyPress(name, mods, bytes: bytes);
    _latch.consumeSingles();
  }

  void _toggleMode() {
    HapticFeedback.selectionClick();
    setState(() {
      _mode =
          _mode == SmartKeyMode.keys ? SmartKeyMode.nav : SmartKeyMode.keys;
    });
  }

  Future<void> _pickImage(ImageSource source) async {
    final handler = widget.onUploadImage;
    if (handler == null) return;
    if (_uploading) return;
    setState(() => _uploading = true);
    try {
      final picked = await _picker.pickImage(source: source);
      if (picked == null) return;
      final bytes = await picked.readAsBytes();
      final mime = _mimeFromPath(picked.path);
      await handler(bytes, mime);
    } catch (err, st) {
      // Surface failures without crashing the strip; native logs catch the
      // detail. Use debugPrint so release builds drop the log automatically.
      debugPrint('SmartKeyStrip image upload failed: $err\n$st');
    } finally {
      if (mounted) {
        setState(() => _uploading = false);
      }
    }
  }

  /// Guess MIME from file extension. The OS picker hands us a real
  /// file path so the extension is reliable; we keep this list aligned
  /// with `/api/images` server-side allowlist (jpeg/png/gif/webp).
  String _mimeFromPath(String path) {
    final lower = path.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.heic') || lower.endsWith('.heif')) {
      // iOS picker can hand back HEIC; we re-encode by trusting
      // image_picker's iOS HEIC→JPEG conversion is off, so default
      // to image/jpeg which the server accepts. Callers that want
      // strict HEIC support should add it to the server allowlist.
      return 'image/jpeg';
    }
    return 'image/jpeg';
  }

  // ── Key configs (mirrors src/components/terminal/MobileKeyboard.tsx) ──

  static const _quickKeys = <_KeyConfig>[
    _KeyConfig(label: 'Esc', name: 'Escape'),
    _KeyConfig(label: '^C', name: '__bytes__', bytes: '\x03'),
    _KeyConfig(label: '^D', name: '__bytes__', bytes: '\x04'),
  ];

  static const _modifierKeys = <_KeyConfig>[
    _KeyConfig(label: 'Ctrl', name: 'ctrl', isModifier: true),
    _KeyConfig(label: 'Alt', name: 'alt', isModifier: true),
    _KeyConfig(label: 'Shift', name: 'shift', isModifier: true),
  ];

  static const _keysRow1 = <_KeyConfig>[
    ..._quickKeys,
    _KeyConfig(label: 'Tab', name: 'Tab'),
    ..._modifierKeys,
  ];

  static const _keysRow2 = <_KeyConfig>[
    _KeyConfig(label: '|', name: '__bytes__', bytes: '|'),
    _KeyConfig(label: '/', name: '__bytes__', bytes: '/'),
    _KeyConfig(label: '~', name: '__bytes__', bytes: '~'),
    _KeyConfig(label: '-', name: '__bytes__', bytes: '-'),
    _KeyConfig(label: '_', name: '__bytes__', bytes: '_'),
    _KeyConfig(label: ':', name: '__bytes__', bytes: ':'),
  ];

  static const _navRow1 = <_KeyConfig>[
    _KeyConfig(label: 'Home', name: 'Home'),
    _KeyConfig(label: 'End', name: 'End'),
    _KeyConfig(label: 'Enter', name: 'Enter'),
    // Shift+Enter as a precomposed sequence (ESC + CR) — matches PWA's
    // NAV_ROW1 `⇧↵` button which sends `\x1b\r`.
    _KeyConfig(label: '⇧↵', name: '__bytes__', bytes: '\x1b\r'),
    ..._modifierKeys,
  ];

  static const _navRow2 = <_KeyConfig>[
    ..._quickKeys,
    _KeyConfig(label: 'PgUp', name: 'PageUp'),
    _KeyConfig(label: 'PgDn', name: 'PageDown'),
  ];

  static const _navDpadTop = _KeyConfig(label: '↑', name: 'ArrowUp');
  static const _navDpadBottom = <_KeyConfig>[
    _KeyConfig(label: '←', name: 'ArrowLeft'),
    _KeyConfig(label: '↓', name: 'ArrowDown'),
    _KeyConfig(label: '→', name: 'ArrowRight'),
  ];

  Widget _key(_KeyConfig config, {double? minWidth}) {
    final modName = config.isModifier ? config.name.toLowerCase() : null;
    final state =
        modName != null ? _latch.stateOf(modName) : LatchState.off;
    final color = switch (state) {
      LatchState.off => const Color(0xFF24283B),
      LatchState.single => const Color(0xFF7AA2F7),
      LatchState.locked => const Color(0xFFBB9AF7),
    };
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: Material(
        color: color,
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap: () => _press(
            modName ?? config.name,
            isModifier: config.isModifier,
            bytes: config.bytes,
          ),
          child: Container(
            constraints: BoxConstraints(minWidth: minWidth ?? 0),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            alignment: Alignment.center,
            child: Text(
              config.label,
              style: const TextStyle(color: Colors.white, fontSize: 13),
            ),
          ),
        ),
      ),
    );
  }

  Widget _modeButton() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Material(
        color: const Color(0xFF1F2335),
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap: _toggleMode,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Text(
              _mode == SmartKeyMode.keys ? 'NAV' : 'KEYS',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget? _imageButton() {
    if (widget.onUploadImage == null) return null;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Material(
        color: const Color(0xFF24283B),
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap: _uploading
              ? null
              : () => _pickImage(ImageSource.gallery),
          // Long-press shoots straight to the camera. Skip the gesture
          // on platforms without a camera plugin path (web/desktop).
          onLongPress: _uploading || kIsWeb
              ? null
              : (Platform.isAndroid || Platform.isIOS)
                  ? () => _pickImage(ImageSource.camera)
                  : null,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            child: _uploading
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor:
                          AlwaysStoppedAnimation<Color>(Colors.white),
                    ),
                  )
                : const Icon(
                    Icons.image_outlined,
                    color: Colors.white,
                    size: 16,
                  ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Single-row layout: choose row contents based on mode. The screen
    // height budget (44px from session_view_screen.dart) is fixed, so
    // we stay single-row and scroll horizontally — the PWA's
    // two-row layout has more vertical space available.
    final row = _mode == SmartKeyMode.keys
        ? <Widget>[
            for (final k in _keysRow1) _key(k),
            for (final k in _keysRow2) _key(k),
          ]
        : <Widget>[
            _key(_navDpadTop),
            for (final k in _navDpadBottom) _key(k),
            for (final k in _navRow1) _key(k),
            for (final k in _navRow2) _key(k),
          ];

    final imageBtn = _imageButton();

    return Container(
      color: const Color(0xFF1A1B26),
      height: 44,
      child: Row(
        children: [
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: Row(children: row),
            ),
          ),
          // Pinned trailing controls (don't scroll). Mode toggle is
          // always visible; image button only when handler is wired.
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                _modeButton(),
                if (imageBtn != null) imageBtn,
                const SizedBox(width: 4),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _KeyConfig {
  const _KeyConfig({
    required this.label,
    required this.name,
    this.bytes,
    this.isModifier = false,
  });

  final String label;
  final String name;

  /// When non-null, [_press] passes these raw bytes through to the JS
  /// bridge instead of the named-key path. Used for `^C`/`^D`, common
  /// shell punctuation, and `⇧↵` (Shift-Enter = ESC + CR).
  final String? bytes;

  final bool isModifier;
}

