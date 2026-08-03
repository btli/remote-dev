import 'dart:convert';

/// Maximum text payload accepted across the native clipboard bridge.
const maxClipboardSyncUtf8Bytes = 1024 * 1024;

/// Validated payload emitted by bridge v5's `onClipboardWrite` handler.
class ClipboardWritePayload {
  const ClipboardWritePayload({required this.text, required this.revision});

  final String text;
  final int revision;
}

/// Parses the first JavaScript-handler argument defensively.
///
/// The canonical shape is `{text: string, revision: number}`. Empty text,
/// fractional/negative revisions, malformed values, and text over 1 MiB UTF-8
/// are ignored.
ClipboardWritePayload? parseClipboardWritePayload(List<dynamic> args) {
  if (args.isEmpty || args.first is! Map) return null;
  final map = args.first as Map;
  final rawText = map['text'];
  final rawRevision = map['revision'];
  if (rawText is! String || !_isSyncableText(rawText)) return null;
  if (rawRevision is! num || !rawRevision.isFinite || rawRevision < 0) {
    return null;
  }
  final revision = rawRevision.toInt();
  if (revision.toDouble() != rawRevision.toDouble()) return null;
  return ClipboardWritePayload(text: rawText, revision: revision);
}

bool _isSyncableText(String text) {
  if (text.isEmpty) return false;
  return utf8.encode(text).length <= maxClipboardSyncUtf8Bytes;
}

typedef ClipboardTextReader = Future<String?> Function();
typedef ClipboardTextWriter = Future<void> Function(String text);

/// Reads selection text from bridge v5's canonical `{text}` payload while
/// retaining compatibility with the older bare-string shape.
String? parseSelectionChangePayload(List<dynamic> args) {
  if (args.isEmpty) return null;
  final first = args.first;
  final raw = first is Map ? first['text'] : first;
  return raw is String && raw.isNotEmpty ? raw : null;
}

/// Coordinates clipboard behavior for one mounted session route.
///
/// Platform clipboard access and bridge calls are injected so lifecycle,
/// opt-in, validation, and echo behavior remain unit-testable without a native
/// WebView or platform clipboard. The coordinator never polls and never logs
/// clipboard contents.
class SessionClipboardSync {
  SessionClipboardSync({
    required bool Function() isEnabled,
    required bool Function() isCurrent,
    required bool Function() isPresentationReady,
    required bool Function() isBridgeReady,
    required void Function(bool enabled) setBridgeEnabled,
    required void Function(String text) syncBridgeText,
    required void Function(String text) pasteToTerminal,
    required void Function() refitTerminal,
    required ClipboardTextReader readClipboardText,
    required ClipboardTextWriter writeClipboardText,
  }) : _isEnabled = isEnabled,
       _isCurrent = isCurrent,
       _isPresentationReady = isPresentationReady,
       _isBridgeReady = isBridgeReady,
       _setBridgeEnabled = setBridgeEnabled,
       _syncBridgeText = syncBridgeText,
       _pasteToTerminal = pasteToTerminal,
       _refitTerminal = refitTerminal,
       _readClipboardText = readClipboardText,
       _writeClipboardText = writeClipboardText;

  final bool Function() _isEnabled;
  final bool Function() _isCurrent;
  final bool Function() _isPresentationReady;
  final bool Function() _isBridgeReady;
  final void Function(bool enabled) _setBridgeEnabled;
  final void Function(String text) _syncBridgeText;
  final void Function(String text) _pasteToTerminal;
  final void Function() _refitTerminal;
  final ClipboardTextReader _readClipboardText;
  final ClipboardTextWriter _writeClipboardText;

  int? _lastRemoteRevision;
  String? _lastRemoteText;
  String? _pendingRemoteEcho;

  bool get _isPresented => _isCurrent() && _isPresentationReady();

  bool get _canAccessClipboard => _isPresented && _isBridgeReady();

  /// Pushes the persisted opt-in and, when enabled, the native clipboard after
  /// the terminal marks its bridge ready.
  Future<void> onTerminalReady() async {
    if (!_isPresented) {
      onPresentationUnavailable();
      return;
    }
    final enabled = _isEnabled();
    if (!enabled) {
      onPresentationUnavailable();
      return;
    }
    _setBridgeEnabled(true);
    await _publishNativeClipboard();
  }

  /// Refits first, then refreshes clipboard state when the current route
  /// returns to the foreground.
  Future<void> onAppResumed() async {
    await _restoreCurrentRoute();
  }

  /// Mirrors an opt-in transition into the bridge. Turning sync on publishes
  /// the current native clipboard immediately.
  Future<void> onSettingChanged(bool enabled) async {
    if (!_isPresented) {
      onPresentationUnavailable();
      return;
    }
    if (!enabled) {
      onPresentationUnavailable();
      return;
    }
    _setBridgeEnabled(true);
    await _publishNativeClipboard();
  }

  /// Unsubscribes a still-mounted WebView as soon as another route covers it.
  void onRouteCovered() => onPresentationUnavailable();

  /// Synchronously revokes the WebView subscription when the app backgrounds,
  /// locks, becomes covered, or is being disposed.
  void onPresentationUnavailable() {
    _lastRemoteText = null;
    _pendingRemoteEcho = null;
    _setBridgeEnabled(false);
  }

  /// Reconciles the current bridge state after the global foreground/unlocked
  /// gate changes.
  Future<void> onPresentationReadinessChanged(bool ready) async {
    if (!ready || !_isPresented) {
      onPresentationUnavailable();
      return;
    }
    await _restoreCurrentRoute();
  }

  /// Restores the current route after a covering route is popped.
  Future<void> onRouteRevealed() async {
    await _restoreCurrentRoute();
  }

  /// Preserves native copy-on-selection and additionally publishes the text
  /// to this session when synchronization is enabled.
  Future<void> onSelectionChange(String? selection) async {
    if (selection == null || selection.isEmpty || !_canAccessClipboard) {
      return;
    }
    await _safeWriteClipboard(selection);
    if (!_canAccessClipboard) return;
    _publishText(selection, requireCurrent: true);
  }

  /// Preserves terminal paste and additionally publishes the pasted clipboard
  /// text to this session when synchronization is enabled.
  Future<void> onWantsPaste() async {
    if (!_canAccessClipboard) return;
    final text = await _safeReadClipboard();
    if (text == null || text.isEmpty || !_canAccessClipboard) return;
    _pasteToTerminal(text);
    _publishText(text, requireCurrent: true);
  }

  /// Applies a validated remote update only for the opted-in current route.
  /// An exact repeated `(revision, text)` pair and the next matching local
  /// echo are suppressed. Lower revisions remain valid after a remote epoch
  /// reset.
  Future<void> onClipboardWrite(List<dynamic> args) async {
    final payload = parseClipboardWritePayload(args);
    if (payload == null || !_isEnabled() || !_canAccessClipboard) return;
    if (_lastRemoteRevision == payload.revision &&
        _lastRemoteText == payload.text) {
      return;
    }
    final wrote = await _safeWriteClipboard(payload.text);
    if (wrote && _isEnabled() && _canAccessClipboard) {
      _lastRemoteRevision = payload.revision;
      _lastRemoteText = payload.text;
      _pendingRemoteEcho = payload.text;
    }
  }

  Future<void> _publishNativeClipboard() async {
    if (!_canAccessClipboard) return;
    final text = await _safeReadClipboard();
    if (text != null && _canAccessClipboard) {
      _publishText(text, requireCurrent: true);
    }
  }

  Future<void> _restoreCurrentRoute() async {
    if (!_isPresented) {
      onPresentationUnavailable();
      return;
    }
    _refitTerminal();
    final enabled = _isEnabled();
    if (!enabled) {
      onPresentationUnavailable();
      return;
    }
    _setBridgeEnabled(true);
    await _publishNativeClipboard();
  }

  void _publishText(String text, {bool requireCurrent = false}) {
    if (!_isEnabled() ||
        !_isPresentationReady() ||
        !_isBridgeReady() ||
        (requireCurrent && !_isCurrent())) {
      return;
    }
    if (!_isSyncableText(text)) return;
    final echo = _pendingRemoteEcho;
    _pendingRemoteEcho = null;
    if (echo == text) return;
    _syncBridgeText(text);
  }

  Future<String?> _safeReadClipboard() async {
    try {
      return await _readClipboardText();
    } catch (_) {
      return null;
    }
  }

  Future<bool> _safeWriteClipboard(String text) async {
    try {
      await _writeClipboardText(text);
      return true;
    } catch (_) {
      return false;
    }
  }
}
