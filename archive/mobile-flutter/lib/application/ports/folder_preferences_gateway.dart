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

  /// The best available path for git operations.
  /// Prefers [localRepoPath], falls back to [defaultWorkingDirectory].
  String? get gitPath => localRepoPath ?? defaultWorkingDirectory;

  /// Whether this folder has a usable git repository path.
  /// Only true when [gitPath] is non-null, ensuring the worktree toggle
  /// is only enabled when branch fetching can actually succeed.
  bool get hasGitRepo => gitPath != null;
}

/// Abstract gateway for folder preference operations.
abstract interface class FolderPreferencesGateway {
  /// Returns preferences keyed by folder ID.
  Future<Result<Map<String, FolderPreferences>>> getAllFolderPreferences();
}
