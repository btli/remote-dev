import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class MobileInputBar extends StatefulWidget {
  const MobileInputBar({
    required this.onSend,
    this.onPasteWithoutExecute,
    this.placeholder = 'Type a command…',
    super.key,
  });

  /// Called when the user submits text (Enter or send button).
  /// Receives the typed text; the bar clears the field after.
  final ValueChanged<String> onSend;

  /// Called when the user long-presses the input field.
  /// Implementation should read clipboard and set [setText].
  /// Phase 2 stub: pastes via the controller; the parent (P2.9) wires
  /// the actual `bridge.paste(text)` for the WITHOUT-execute semantics
  /// (i.e., this callback fires when the bar wants to surface a paste
  /// action that should NOT auto-submit).
  final Future<void> Function(void Function(String) setText)? onPasteWithoutExecute;

  final String placeholder;

  @override
  State<MobileInputBar> createState() => _MobileInputBarState();
}

class _MobileInputBarState extends State<MobileInputBar> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  bool _hasText = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onChanged);
  }

  @override
  void dispose() {
    _controller.removeListener(_onChanged);
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _onChanged() {
    final has = _controller.text.isNotEmpty;
    if (has != _hasText) {
      setState(() => _hasText = has);
    }
  }

  void _send() {
    final text = _controller.text;
    if (text.isEmpty) return;
    widget.onSend(text);
    _controller.clear();
  }

  Future<void> _handleLongPress() async {
    final cb = widget.onPasteWithoutExecute;
    if (cb == null) {
      // Default fallback: paste from system clipboard into field.
      final data = await Clipboard.getData(Clipboard.kTextPlain);
      final text = data?.text;
      if (text != null && text.isNotEmpty) {
        _controller.text = _controller.text + text;
      }
      return;
    }
    await cb((text) {
      _controller.text = _controller.text + text;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF24283B),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      // No SafeArea: the parent (session_view_screen.dart) already reserves the
      // bottom inset for the whole floating chrome via bottomReserve = max(
      // keyboardInset, padding.bottom) and floats it at Positioned(bottom:
      // bottomReserve). Re-applying MediaQuery.padding.bottom here double-counted
      // it and crushed this fixed-height (56px) bar's TextField to ~0 when the
      // keyboard was down (small-input-on-load bug).
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: TextField(
              controller: _controller,
              focusNode: _focusNode,
              // Real native keyboard behavior.
              autocorrect: true,
              enableSuggestions: true,
              enableIMEPersonalizedLearning: true,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _send(),
              minLines: 1,
              maxLines: 4,
              style: const TextStyle(color: Colors.white, fontSize: 14),
              decoration: InputDecoration(
                hintText: widget.placeholder,
                hintStyle: const TextStyle(color: Colors.white38, fontSize: 14),
                isDense: true,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                filled: true,
                fillColor: const Color(0xFF1A1B26),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          // Long-press the send button → paste without execute.
          // (Long-press on the TextField itself is reserved by Flutter for
          // native text-selection / clipboard menu — preserving that is part
          // of the "truly native" promise. The send button is a discoverable
          // affordance for the paste-without-execute action.)
          GestureDetector(
            onLongPress: _handleLongPress,
            child: IconButton(
              icon: const Icon(Icons.send),
              color: _hasText ? const Color(0xFF7AA2F7) : Colors.white24,
              onPressed: _hasText ? _send : null,
            ),
          ),
        ],
      ),
    );
  }
}
