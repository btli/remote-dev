import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// A stepper widget for port numbers: [-] [6001] [+]
///
/// Material 3 styled with haptic feedback on increment/decrement.
/// Supports tap-to-edit the center value directly.
class PortStepper extends StatefulWidget {
  const PortStepper({
    super.key,
    required this.value,
    required this.onChanged,
    this.min = 1,
    this.max = 65535,
    this.step = 1,
    this.label,
    this.enabled = true,
  });

  final int value;
  final ValueChanged<int> onChanged;
  final int min;
  final int max;
  final int step;
  final String? label;
  final bool enabled;

  @override
  State<PortStepper> createState() => _PortStepperState();
}

class _PortStepperState extends State<PortStepper> {
  bool _isEditing = false;
  late TextEditingController _controller;
  late FocusNode _focusNode;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.value.toString());
    _focusNode = FocusNode()
      ..addListener(() {
        if (!_focusNode.hasFocus && _isEditing) {
          _commitEdit();
        }
      });
  }

  @override
  void didUpdateWidget(PortStepper old) {
    super.didUpdateWidget(old);
    if (!_isEditing && old.value != widget.value) {
      _controller.text = widget.value.toString();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _decrement() {
    if (!widget.enabled) return;
    final newValue = (widget.value - widget.step).clamp(widget.min, widget.max);
    if (newValue != widget.value) {
      HapticFeedback.lightImpact();
      widget.onChanged(newValue);
    }
  }

  void _increment() {
    if (!widget.enabled) return;
    final newValue = (widget.value + widget.step).clamp(widget.min, widget.max);
    if (newValue != widget.value) {
      HapticFeedback.lightImpact();
      widget.onChanged(newValue);
    }
  }

  void _startEditing() {
    if (!widget.enabled) return;
    setState(() {
      _isEditing = true;
      _controller.text = widget.value.toString();
      _controller.selection = TextSelection(
        baseOffset: 0,
        extentOffset: _controller.text.length,
      );
    });
    _focusNode.requestFocus();
  }

  void _commitEdit() {
    final parsed = int.tryParse(_controller.text.trim());
    if (parsed != null) {
      final clamped = parsed.clamp(widget.min, widget.max);
      widget.onChanged(clamped);
    }
    setState(() => _isEditing = false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.label != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              widget.label!,
              style: theme.textTheme.labelMedium?.copyWith(
                color: colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        Container(
          decoration: BoxDecoration(
            color: colorScheme.surfaceContainer,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: _isEditing
                  ? colorScheme.primary
                  : colorScheme.outlineVariant,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Decrement button
              _StepButton(
                icon: Icons.remove_rounded,
                onPressed: widget.value > widget.min ? _decrement : null,
                enabled: widget.enabled && widget.value > widget.min,
                borderRadius: const BorderRadius.horizontal(
                  left: Radius.circular(11),
                ),
              ),

              // Value display / edit
              _isEditing
                  ? SizedBox(
                      width: 72,
                      child: TextField(
                        controller: _controller,
                        focusNode: _focusNode,
                        keyboardType: TextInputType.number,
                        textAlign: TextAlign.center,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontFamily: 'JetBrainsMono Nerd Font',
                          fontWeight: FontWeight.w600,
                        ),
                        decoration: const InputDecoration(
                          border: InputBorder.none,
                          contentPadding: EdgeInsets.symmetric(vertical: 12),
                          isDense: true,
                          filled: false,
                        ),
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                          LengthLimitingTextInputFormatter(5),
                        ],
                        onSubmitted: (_) => _commitEdit(),
                      ),
                    )
                  : GestureDetector(
                      onTap: _startEditing,
                      child: Container(
                        width: 72,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        alignment: Alignment.center,
                        child: Text(
                          widget.value.toString(),
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontFamily: 'JetBrainsMono Nerd Font',
                            fontWeight: FontWeight.w600,
                            color: widget.enabled
                                ? colorScheme.onSurface
                                : colorScheme.onSurface.withValues(alpha: 0.38),
                          ),
                        ),
                      ),
                    ),

              // Increment button
              _StepButton(
                icon: Icons.add_rounded,
                onPressed: widget.value < widget.max ? _increment : null,
                enabled: widget.enabled && widget.value < widget.max,
                borderRadius: const BorderRadius.horizontal(
                  right: Radius.circular(11),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({
    required this.icon,
    required this.onPressed,
    required this.enabled,
    required this.borderRadius,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final bool enabled;
  final BorderRadius borderRadius;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onPressed,
        borderRadius: borderRadius,
        child: Container(
          width: 44,
          height: 44,
          alignment: Alignment.center,
          child: Icon(
            icon,
            size: 20,
            color: enabled
                ? colorScheme.onSurfaceVariant
                : colorScheme.onSurface.withValues(alpha: 0.38),
          ),
        ),
      ),
    );
  }
}
