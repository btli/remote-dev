import 'package:remote_dev/domain/entities/folder.dart';
import 'package:remote_dev/domain/errors/app_error.dart';

/// Abstract repository interface for folder operations.
abstract interface class FolderRepository {
  Future<Result<List<Folder>>> findAll();
  Future<Result<Folder>> create({required String name, String? parentId});
  Future<Result<void>> update(String id, {String? name, String? parentId});
  Future<Result<void>> delete(String id);
}
