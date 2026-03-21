import 'package:remote_dev/domain/entities/session.dart';
import 'package:remote_dev/domain/errors/app_error.dart';

/// Input for creating a new session.
class CreateSessionInput {
  final String name;
  final String? projectPath;
  final String? folderId;
  final String? profileId;
  final String? terminalType;
  final String? agentProvider;
  final bool autoLaunchAgent;
  final List<String>? agentFlags;
  final String? startupCommand;
  final String? parentSessionId;

  // Worktree fields
  final bool createWorktree;
  final String? worktreeType;
  final String? baseBranch;
  final String? featureDescription;

  const CreateSessionInput({
    required this.name,
    this.projectPath,
    this.folderId,
    this.profileId,
    this.terminalType,
    this.agentProvider,
    this.autoLaunchAgent = false,
    this.agentFlags,
    this.startupCommand,
    this.parentSessionId,
    this.createWorktree = false,
    this.worktreeType,
    this.baseBranch,
    this.featureDescription,
  });
}

/// Abstract repository interface for session operations.
/// Implemented by the infrastructure layer's API-backed repository.
abstract interface class SessionRepository {
  Future<Result<List<Session>>> findAll({String? status});
  Future<Result<Session>> findById(String id);
  Future<Result<Session>> create(CreateSessionInput input);
  Future<Result<void>> suspend(String id);
  Future<Result<void>> resume(String id);
  Future<Result<void>> close(String id);
  Future<Result<void>> updateName(String id, String name);
}
