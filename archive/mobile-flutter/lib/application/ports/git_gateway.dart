import 'package:remote_dev/domain/errors/app_error.dart';

/// Result of validating a filesystem path as a git repository.
class GitValidationResult {
  const GitValidationResult({
    required this.isGitRepo,
    required this.branches,
  });

  final bool isGitRepo;
  final List<String> branches;
}

/// Abstract gateway for git-related server queries.
///
/// Read-only operations (not CRUD persistence), following the
/// [AppearanceGateway] pattern for lightweight gateways.
abstract interface class GitGateway {
  /// Validates a path as a git repo and returns its local branches.
  Future<Result<GitValidationResult>> validateAndListBranches(String path);
}
