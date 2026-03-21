/// Direction of a split pane group.
enum SplitDirection {
  horizontal,
  vertical;

  static SplitDirection fromString(String value) => switch (value) {
        'horizontal' => SplitDirection.horizontal,
        'vertical' => SplitDirection.vertical,
        _ => SplitDirection.horizontal,
      };
}

/// Split pane group for displaying multiple terminals side-by-side.
class SplitGroup {
  final String id;
  final String userId;
  final String name;
  final SplitDirection direction;
  final List<SplitPane> panes;
  final DateTime createdAt;

  const SplitGroup({
    required this.id,
    required this.userId,
    required this.name,
    required this.direction,
    required this.panes,
    required this.createdAt,
  });

  bool get isHorizontal => direction == SplitDirection.horizontal;
}

/// Individual pane within a split group.
class SplitPane {
  final String sessionId;
  final int order;
  final double size;

  const SplitPane({
    required this.sessionId,
    required this.order,
    required this.size,
  });
}
