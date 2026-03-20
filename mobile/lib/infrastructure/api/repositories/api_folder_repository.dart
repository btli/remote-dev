import 'package:remote_dev/domain/entities/folder.dart';
import 'package:remote_dev/domain/errors/app_error.dart';
import 'package:remote_dev/domain/repositories/folder_repository.dart';
import 'package:remote_dev/infrastructure/api/remote_dev_client.dart';

/// API-backed implementation of [FolderRepository].
class ApiFolderRepository implements FolderRepository {
  ApiFolderRepository({required RemoteDevClient client}) : _client = client;
  final RemoteDevClient _client;

  @override
  Future<Result<FolderListResult>> findAll() async {
    try {
      final response = await _client.listFolders();
      return Success(
        FolderListResult(
          folders: response.folders.map(_mapFolder).toList(),
          sessionFolders: response.sessionFolders,
        ),
      );
    } on AppError catch (e) {
      return Failure(e);
    } on Object catch (e) {
      return Failure(
        ApiError(
          'Failed to parse folders: $e',
          code: 'PARSE_ERROR',
          statusCode: 0,
        ),
      );
    }
  }

  @override
  Future<Result<Folder>> create({required String name, String? parentId}) async {
    try {
      final data = await _client.createFolder({
        'name': name,
        if (parentId != null) 'parentId': parentId,
      });
      return Success(_mapFolder(data));
    } on AppError catch (e) {
      return Failure(e);
    }
  }

  @override
  Future<Result<void>> update(String id, {String? name, String? parentId}) async {
    try {
      await _client.updateFolder(id, {
        if (name != null) 'name': name,
        if (parentId != null) 'parentId': parentId,
      });
      return const Success(null);
    } on AppError catch (e) {
      return Failure(e);
    }
  }

  @override
  Future<Result<void>> delete(String id) async {
    try {
      await _client.deleteFolder(id);
      return const Success(null);
    } on AppError catch (e) {
      return Failure(e);
    }
  }

  Folder _mapFolder(Map<String, dynamic> json) {
    return Folder(
      id: json['id'] as String,
      userId: json['userId'] as String,
      name: json['name'] as String,
      parentId: json['parentId'] as String?,
      icon: json['icon'] as String?,
      sortOrder: json['sortOrder'] as int? ?? 0,
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.now(),
      updatedAt: DateTime.tryParse(json['updatedAt'] as String? ?? '') ??
          DateTime.now(),
    );
  }
}
