import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/application/ports/folder_preferences_gateway.dart';
import 'package:remote_dev/application/ports/git_gateway.dart';
import 'package:remote_dev/infrastructure/api/gateways/api_folder_preferences_gateway.dart';
import 'package:remote_dev/infrastructure/api/gateways/api_git_gateway.dart';
import 'package:remote_dev/presentation/providers/server_config_providers.dart';

// ── Gateway instances ────────────────────────────────────────────────

/// Git gateway instance. Null when unauthenticated.
final gitGatewayProvider = Provider<GitGateway?>((ref) {
  final client = ref.watch(remoteDevClientProvider);
  if (client == null) return null;
  return ApiGitGateway(client: client);
});

/// Folder preferences gateway instance. Null when unauthenticated.
final folderPreferencesGatewayProvider =
    Provider<FolderPreferencesGateway?>((ref) {
  final client = ref.watch(remoteDevClientProvider);
  if (client == null) return null;
  return ApiFolderPreferencesGateway(client: client);
});

// ── Folder preferences ───────────────────────────────────────────────

/// Async folder preferences map: folderId → FolderPreferences.
class FolderPreferencesNotifier
    extends AsyncNotifier<Map<String, FolderPreferences>> {
  @override
  Future<Map<String, FolderPreferences>> build() async {
    final gateway = ref.watch(folderPreferencesGatewayProvider);
    if (gateway == null) return {};
    final result = await gateway.getAllFolderPreferences();
    return result.valueOrThrow;
  }

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() => build());
  }
}

final folderPreferencesProvider = AsyncNotifierProvider<
    FolderPreferencesNotifier, Map<String, FolderPreferences>>(
  FolderPreferencesNotifier.new,
);

/// Derived: preferences for a specific folder.
final folderPreferenceForIdProvider =
    Provider.family<FolderPreferences?, String?>((ref, folderId) {
  if (folderId == null) return null;
  return ref.watch(folderPreferencesProvider).valueOrNull?[folderId];
});

// ── Branch listing ───────────────────────────────────────────────────

/// One-shot branch fetch, keyed by git repo path. Lazy — only triggered
/// when the create session sheet needs branch data.
class BranchListNotifier extends FamilyAsyncNotifier<List<String>, String> {
  @override
  Future<List<String>> build(String path) async {
    final gateway = ref.watch(gitGatewayProvider);
    if (gateway == null) return [];
    final result = await gateway.validateAndListBranches(path);
    return result.valueOrThrow.branches;
  }
}

final branchListProvider =
    AsyncNotifierProvider.family<BranchListNotifier, List<String>, String>(
  BranchListNotifier.new,
);
