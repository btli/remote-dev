import 'package:remote_dev/application/ports/folder_preferences_gateway.dart';
import 'package:remote_dev/domain/errors/app_error.dart';
import 'package:remote_dev/infrastructure/api/remote_dev_client.dart';

/// API-backed implementation of [FolderPreferencesGateway].
///
/// Reuses the existing `GET /api/preferences` endpoint and extracts
/// the `folderPreferences` map from the response.
class ApiFolderPreferencesGateway implements FolderPreferencesGateway {
  ApiFolderPreferencesGateway({required RemoteDevClient client})
      : _client = client;
  final RemoteDevClient _client;

  @override
  Future<Result<Map<String, FolderPreferences>>>
      getAllFolderPreferences() async {
    try {
      final data = await _client.getPreferences();
      // Server returns folderPreferences as an array of objects,
      // each containing a folderId field.
      final rawList = data['folderPreferences'] as List? ?? [];
      final result = <String, FolderPreferences>{};
      for (final item in rawList) {
        final prefs = item as Map<String, dynamic>;
        final folderId = prefs['folderId'] as String?;
        if (folderId == null || folderId.isEmpty) continue;
        result[folderId] = FolderPreferences(
          localRepoPath: prefs['localRepoPath'] as String?,
          githubRepoId: prefs['githubRepoId'] as String?,
          defaultWorkingDirectory:
              prefs['defaultWorkingDirectory'] as String?,
        );
      }
      return Success(result);
    } on AppError catch (e) {
      return Failure(e);
    } on Object catch (e) {
      return Failure(
        ApiError(
          'Failed to parse folder preferences: $e',
          code: 'PARSE_ERROR',
          statusCode: 0,
        ),
      );
    }
  }
}
