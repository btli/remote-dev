import 'package:flutter/material.dart';

/// Split pane layout for tablet mode.
///
/// Renders two or more terminal panes side-by-side (horizontal)
/// or stacked (vertical) with a draggable resize divider.
class SplitPaneLayout extends StatefulWidget {
  const SplitPaneLayout({
    super.key,
    required this.children,
    this.isHorizontal = true,
    this.initialSizes,
    this.onSizesChanged,
    this.minPaneSize = 100.0,
  });

  final List<Widget> children;
  final bool isHorizontal;
  final List<double>? initialSizes;
  final void Function(List<double> sizes)? onSizesChanged;
  final double minPaneSize;

  @override
  State<SplitPaneLayout> createState() => _SplitPaneLayoutState();
}

class _SplitPaneLayoutState extends State<SplitPaneLayout> {
  late List<double> _sizes;

  @override
  void initState() {
    super.initState();
    final count = widget.children.length;
    _sizes = widget.initialSizes ??
        List.generate(count, (_) => 1.0 / count);
  }

  void _onDragUpdate(int dividerIndex, DragUpdateDetails details, double totalSize) {
    setState(() {
      final delta = widget.isHorizontal
          ? details.delta.dx / totalSize
          : details.delta.dy / totalSize;

      final minFraction = widget.minPaneSize / totalSize;

      // Adjust the two adjacent panes
      var newLeft = _sizes[dividerIndex] + delta;
      var newRight = _sizes[dividerIndex + 1] - delta;

      // Clamp to minimum size
      if (newLeft < minFraction) {
        newRight += newLeft - minFraction;
        newLeft = minFraction;
      }
      if (newRight < minFraction) {
        newLeft += newRight - minFraction;
        newRight = minFraction;
      }

      _sizes[dividerIndex] = newLeft;
      _sizes[dividerIndex + 1] = newRight;

      // Normalize to sum to 1.0
      final sum = _sizes.reduce((a, b) => a + b);
      for (var i = 0; i < _sizes.length; i++) {
        _sizes[i] /= sum;
      }
    });
  }

  void _onDragEnd(DragEndDetails _) {
    widget.onSizesChanged?.call(List.from(_sizes));
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final totalSize = widget.isHorizontal
            ? constraints.maxWidth
            : constraints.maxHeight;

        final children = <Widget>[];
        for (var i = 0; i < widget.children.length; i++) {
          // Pane
          final size = _sizes[i] * totalSize;
          children.add(
            SizedBox(
              width: widget.isHorizontal ? size : null,
              height: widget.isHorizontal ? null : size,
              child: widget.children[i],
            ),
          );

          // Divider between panes
          if (i < widget.children.length - 1) {
            children.add(
              _ResizeDivider(
                isHorizontal: widget.isHorizontal,
                onDragUpdate: (details) =>
                    _onDragUpdate(i, details, totalSize),
                onDragEnd: _onDragEnd,
              ),
            );
          }
        }

        return widget.isHorizontal
            ? Row(children: children)
            : Column(children: children);
      },
    );
  }
}

class _ResizeDivider extends StatelessWidget {
  const _ResizeDivider({
    required this.isHorizontal,
    required this.onDragUpdate,
    required this.onDragEnd,
  });

  final bool isHorizontal;
  final void Function(DragUpdateDetails) onDragUpdate;
  final void Function(DragEndDetails) onDragEnd;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return GestureDetector(
      onHorizontalDragUpdate: isHorizontal ? onDragUpdate : null,
      onHorizontalDragEnd: isHorizontal ? onDragEnd : null,
      onVerticalDragUpdate: isHorizontal ? null : onDragUpdate,
      onVerticalDragEnd: isHorizontal ? null : onDragEnd,
      child: MouseRegion(
        cursor: isHorizontal
            ? SystemMouseCursors.resizeColumn
            : SystemMouseCursors.resizeRow,
        child: Container(
          width: isHorizontal ? 8 : double.infinity,
          height: isHorizontal ? double.infinity : 8,
          color: Colors.transparent,
          child: Center(
            child: Container(
              width: isHorizontal ? 2 : 32,
              height: isHorizontal ? 32 : 2,
              decoration: BoxDecoration(
                color: theme.dividerColor.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(1),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
