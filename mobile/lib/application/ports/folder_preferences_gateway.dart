import 'package:remote_dev/domain/errors/app_error.dart';

/// Per-folder preferences relevant to worktree and git operations.
class FolderPreferences {
  const FolderPreferences({
    this.localRepoPath,
    this.githubRepoId,
    this.defaultWorkingDirectory,
  });

  final String? localRepoPath;
  final String? githubRepoId;
  final String? defaultWorkingDirectory;

  /// Whether this folder has a linked git repository.
  bool get hasGitRepo => localRepoPath != null || githubRepoId != null;

  /// The best available path for git operations.
  /// Prefers [localRepoPath], falls back to [defaultWorkingDirectory].
  String? get gitPath => localRepoPath ?? defaultWorkingDirectory;
}

/// Abstract gateway for folder preference operations.
abstract interface class FolderPreferencesGateway {
  /// Returns preferences keyed by folder ID.
  Future<Result<Map<String, FolderPreferences>>> getAllFolderPreferences();
}
