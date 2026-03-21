import 'package:remote_dev/domain/entities/session.dart';
import 'package:remote_dev/domain/errors/app_error.dart';
import 'package:remote_dev/domain/repositories/session_repository.dart';
import 'package:remote_dev/domain/value_objects/agent_provider.dart';
import 'package:remote_dev/domain/value_objects/session_status.dart';
import 'package:remote_dev/domain/value_objects/terminal_type.dart';
import 'package:remote_dev/infrastructure/api/remote_dev_client.dart';

/// API-backed implementation of [SessionRepository].
class ApiSessionRepository implements SessionRepository {
  ApiSessionRepository({required RemoteDevClient client}) : _client = client;
  final RemoteDevClient _client;

  @override
  Future<Result<List<Session>>> findAll({String? status}) async {
    try {
      final data = await _client.listSessions(status: status ?? 'active,suspended');
      return Success(data.map(_mapSession).toList());
    } on AppError catch (e) {
      return Failure(e);
    } on Object catch (e) {
      return Failure(ApiError('Failed to parse sessions: $e', code: 'PARSE_ERROR', statusCode: 0));
    }
  }

  @override
  Future<Result<Session>> findById(String id) async {
    try {
      final data = await _client.getSession(id);
      return Success(_mapSession(data));
    } on AppError catch (e) {
      return Failure(e);
    } on Object catch (e) {
      return Failure(ApiError('Failed to parse session: $e', code: 'PARSE_ERROR', statusCode: 0));
    }
  }

  @override
  Future<Result<Session>> create(CreateSessionInput input) async {
    try {
      final data = await _client.createSession({
        'name': input.name,
        if (input.projectPath != null) 'projectPath': input.projectPath,
        if (input.folderId != null) 'folderId': input.folderId,
        if (input.profileId != null) 'profileId': input.profileId,
        if (input.terminalType != null) 'terminalType': input.terminalType,
        if (input.agentProvider != null) 'agentProvider': input.agentProvider,
        'autoLaunchAgent': input.autoLaunchAgent,
        if (input.agentFlags != null) 'agentFlags': input.agentFlags,
        if (input.startupCommand != null) 'startupCommand': input.startupCommand,
        if (input.parentSessionId != null) 'parentSessionId': input.parentSessionId,
        if (input.createWorktree) 'createWorktree': true,
        if (input.worktreeType != null) 'worktreeType': input.worktreeType,
        if (input.baseBranch != null) 'baseBranch': input.baseBranch,
        if (input.featureDescription != null)
          'featureDescription': input.featureDescription,
      });
      return Success(_mapSession(data));
    } on AppError catch (e) {
      return Failure(e);
    }
  }

  @override
  Future<Result<void>> suspend(String id) async {
    try {
      await _client.suspendSession(id);
      return const Success(null);
    } on AppError catch (e) {
      return Failure(e);
    }
  }

  @override
  Future<Result<void>> resume(String id) async {
    try {
      await _client.resumeSession(id);
      return const Success(null);
    } on AppError catch (e) {
      return Failure(e);
    }
  }

  @override
  Future<Result<void>> close(String id) async {
    try {
      await _client.closeSession(id);
      return const Success(null);
    } on AppError catch (e) {
      return Failure(e);
    }
  }

  @override
  Future<Result<void>> updateName(String id, String name) async {
    try {
      await _client.updateSession(id, {'name': name});
      return const Success(null);
    } on AppError catch (e) {
      return Failure(e);
    }
  }

  Session _mapSession(Map<String, dynamic> json) {
    return Session(
      id: json['id'] as String,
      userId: json['userId'] as String,
      name: json['name'] as String,
      tmuxSessionName: json['tmuxSessionName'] as String,
      projectPath: json['projectPath'] as String?,
      githubRepoId: json['githubRepoId'] as String?,
      worktreeBranch: json['worktreeBranch'] as String?,
      folderId: json['folderId'] as String?,
      profileId: json['profileId'] as String?,
      terminalType: TerminalType.fromString(json['terminalType'] as String? ?? 'shell'),
      agentProvider: AgentProvider.fromString(json['agentProvider'] as String?),
      agentExitState: AgentExitState.fromString(json['agentExitState'] as String?),
      agentExitCode: json['agentExitCode'] as int?,
      agentExitedAt: json['agentExitedAt'] != null
          ? DateTime.tryParse(json['agentExitedAt'] as String)
          : null,
      agentRestartCount: json['agentRestartCount'] as int? ?? 0,
      agentActivityStatus: AgentActivityStatus.fromString(json['agentActivityStatus'] as String?),
      typeMetadata: json['typeMetadata'] as Map<String, dynamic>?,
      parentSessionId: json['parentSessionId'] as String?,
      splitGroupId: json['splitGroupId'] as String?,
      splitOrder: json['splitOrder'] as int? ?? 0,
      splitSize: (json['splitSize'] as num?)?.toDouble() ?? 1.0,
      status: SessionStatus.fromString(json['status'] as String? ?? 'active'),
      pinned: json['pinned'] as bool? ?? false,
      tabOrder: json['tabOrder'] as int? ?? 0,
      lastActivityAt: DateTime.tryParse(json['lastActivityAt'] as String? ?? '') ?? DateTime.now(),
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
      updatedAt: DateTime.tryParse(json['updatedAt'] as String? ?? '') ?? DateTime.now(),
    );
  }
}
