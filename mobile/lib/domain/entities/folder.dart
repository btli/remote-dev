/// Immutable domain entity representing a session folder.
///
/// Folders form a hierarchical tree via [parentId]. Sessions are organized
/// into folders, and preferences inherit down the folder chain.
class Folder {
  final String id;
  final String userId;
  final String name;
  final String? parentId;
  final String? icon;
  final int sortOrder;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Folder({
    required this.id,
    required this.userId,
    required this.name,
    this.parentId,
    this.icon,
    this.sortOrder = 0,
    required this.createdAt,
    required this.updatedAt,
  });

  bool get isRoot => parentId == null;

  /// Copy with updated fields. Use [clearParentId] to move folder to root.
  Folder copyWith({
    String? name,
    String? parentId,
    bool clearParentId = false,
    String? icon,
    int? sortOrder,
  }) {
    return Folder(
      id: id,
      userId: userId,
      name: name ?? this.name,
      parentId: clearParentId ? null : (parentId ?? this.parentId),
      icon: icon ?? this.icon,
      sortOrder: sortOrder ?? this.sortOrder,
      createdAt: createdAt,
      updatedAt: DateTime.now(),
    );
  }
}
