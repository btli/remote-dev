import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class PinchZoomWrapper extends StatefulWidget {
  const PinchZoomWrapper({
    required this.child,
    required this.sessionId,
    required this.onFontSizeChanged,
    this.minFontSize = 9,
    this.maxFontSize = 22,
    this.defaultFontSize = 12,
    super.key,
  });

  final Widget child;
  final String sessionId;
  final ValueChanged<int> onFontSizeChanged;
  final int minFontSize;
  final int maxFontSize;
  final int defaultFontSize;

  @override
  State<PinchZoomWrapper> createState() => _PinchZoomWrapperState();
}

class _PinchZoomWrapperState extends State<PinchZoomWrapper> {
  late int _fontSize;
  int _scaleStartFontSize = 12;

  String get _key => 'fontSize.${widget.sessionId}';

  @override
  void initState() {
    super.initState();
    _fontSize = widget.defaultFontSize;
    _restoreFontSize();
  }

  Future<void> _restoreFontSize() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getInt(_key);
    if (stored != null) {
      _fontSize = stored.clamp(widget.minFontSize, widget.maxFontSize);
      widget.onFontSizeChanged(_fontSize);
    }
  }

  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_key, _fontSize);
  }

  void _onScaleStart(ScaleStartDetails _) {
    _scaleStartFontSize = _fontSize;
  }

  void _onScaleUpdate(ScaleUpdateDetails details) {
    // Map scale 0.5..2.0 -> -3px..+3px relative to start size.
    final delta = ((details.scale - 1.0) * 6).round();
    final next = (_scaleStartFontSize + delta)
        .clamp(widget.minFontSize, widget.maxFontSize);
    if (next != _fontSize) {
      _fontSize = next;
      widget.onFontSizeChanged(_fontSize);
    }
  }

  void _onScaleEnd(ScaleEndDetails _) {
    _persist();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onScaleStart: _onScaleStart,
      onScaleUpdate: _onScaleUpdate,
      onScaleEnd: _onScaleEnd,
      child: widget.child,
    );
  }
}
