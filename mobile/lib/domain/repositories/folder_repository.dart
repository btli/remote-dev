import 'package:remote_dev/domain/entities/folder.dart';
import 'package:remote_dev/domain/errors/app_error.dart';

/// Result of fetching folders, includes both folders and session-folder mapping.
class FolderListResult {
  const FolderListResult({
    required this.folders,
    required this.sessionFolders,
  });

  /// All folders in the hierarchy.
  final List<Folder> folders;

  /// Mapping of session ID to folder ID.
  final Map<String, String> sessionFolders;
}

/// Abstract repository interface for folder operations.
abstract interface class FolderRepository {
  Future<Result<FolderListResult>> findAll();
  Future<Result<Folder>> create({required String name, String? parentId});
  Future<Result<void>> update(String id, {String? name, String? parentId});
  Future<Result<void>> delete(String id);
}
