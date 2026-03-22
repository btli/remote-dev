import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/domain/entities/folder.dart';
import 'package:remote_dev/domain/entities/session.dart';
import 'package:remote_dev/domain/repositories/folder_repository.dart';
import 'package:remote_dev/infrastructure/api/repositories/api_folder_repository.dart';
import 'package:remote_dev/presentation/providers/server_config_providers.dart';
import 'package:remote_dev/presentation/providers/session_providers.dart';

/// Folder repository backed by the API client.
final folderRepositoryProvider = Provider<FolderRepository?>((ref) {
  final client = ref.watch(remoteDevClientProvider);
  if (client == null) return null;
  return ApiFolderRepository(client: client);
});

/// Async folder list + session-folder mapping, auto-refreshed when the
/// repository changes.
class FolderListNotifier extends AsyncNotifier<FolderListResult> {
  @override
  Future<FolderListResult> build() async {
    final repo = ref.watch(folderRepositoryProvider);
    if (repo == null) {
      return const FolderListResult(folders: [], sessionFolders: {});
    }
    final result = await repo.findAll();
    return result.valueOrThrow;
  }

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() => build());
  }
}

final folderListProvider =
    AsyncNotifierProvider<FolderListNotifier, FolderListResult>(
  FolderListNotifier.new,
);

/// Convenience provider for just the folder list.
final foldersProvider = Provider<List<Folder>>((ref) {
  return ref.watch(folderListProvider).valueOrNull?.folders ?? [];
});

/// Convenience provider for the session-to-folder mapping.
final sessionFoldersProvider = Provider<Map<String, String>>((ref) {
  return ref.watch(folderListProvider).valueOrNull?.sessionFolders ?? {};
});

/// Currently active folder ID. Null means "All sessions".
final activeFolderIdProvider = StateProvider<String?>((ref) => null);

/// Sessions filtered by the active folder. When activeFolderId is null,
/// all sessions are shown. Otherwise, sessions belonging to the selected
/// folder or any of its descendants are included.
final filteredSessionsProvider = Provider<List<Session>>((ref) {
  final activeFolderId = ref.watch(activeFolderIdProvider);
  final sessions = ref.watch(sessionListProvider).valueOrNull ?? [];

  if (activeFolderId == null) return sessions;

  final sessionFolders = ref.watch(sessionFoldersProvider);
  final allFolders = ref.watch(foldersProvider);
  final folderIds = Folder.subtreeIds(activeFolderId, allFolders);

  return sessions.where((session) {
    final fid = session.folderId ?? sessionFolders[session.id];
    return fid != null && folderIds.contains(fid);
  }).toList();
});
