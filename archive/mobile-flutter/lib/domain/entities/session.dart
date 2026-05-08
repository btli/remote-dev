import 'package:remote_dev/domain/value_objects/agent_provider.dart';
import 'package:remote_dev/domain/value_objects/session_status.dart';
import 'package:remote_dev/domain/value_objects/terminal_type.dart';

/// Immutable domain entity representing a terminal session.
///
/// Mirrors the TypeScript `TerminalSession` interface from the backend.
/// State changes return new instances via [copyWith].
class Session {
  final String id;
  final String userId;
  final String name;
  final String tmuxSessionName;
  final String? projectPath;
  final String? githubRepoId;
  final String? worktreeBranch;
  final String? folderId;
  final String? profileId;
  final TerminalType terminalType;
  final AgentProvider agentProvider;
  final AgentExitState? agentExitState;
  final int? agentExitCode;
  final DateTime? agentExitedAt;
  final int agentRestartCount;
  final AgentActivityStatus? agentActivityStatus;
  final Map<String, dynamic>? typeMetadata;
  final String? parentSessionId;
  final SessionStatus status;
  final bool pinned;
  final int tabOrder;
  final DateTime lastActivityAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Session({
    required this.id,
    required this.userId,
    required this.name,
    required this.tmuxSessionName,
    this.projectPath,
    this.githubRepoId,
    this.worktreeBranch,
    this.folderId,
    this.profileId,
    this.terminalType = TerminalType.shell,
    this.agentProvider = AgentProvider.none,
    this.agentExitState,
    this.agentExitCode,
    this.agentExitedAt,
    this.agentRestartCount = 0,
    this.agentActivityStatus,
    this.typeMetadata,
    this.parentSessionId,
    required this.status,
    this.pinned = false,
    this.tabOrder = 0,
    required this.lastActivityAt,
    required this.createdAt,
    required this.updatedAt,
  });

  bool get isActive => status is Active;
  bool get isSuspended => status is Suspended;
  bool get isAgent => terminalType == TerminalType.agent;
  bool get hasTerminal => terminalType.hasTerminal;

  /// Whether the agent process has exited and needs attention.
  bool get agentNeedsAttention =>
      isAgent && agentExitState == AgentExitState.exited;

  /// Whether the agent is waiting for user input.
  bool get agentIsWaiting =>
      agentActivityStatus == AgentActivityStatus.waiting;

  Session copyWith({
    String? name,
    SessionStatus? status,
    AgentExitState? agentExitState,
    int? agentExitCode,
    DateTime? agentExitedAt,
    int? agentRestartCount,
    AgentActivityStatus? agentActivityStatus,
    bool? pinned,
    int? tabOrder,
    DateTime? lastActivityAt,
    DateTime? updatedAt,
  }) {
    return Session(
      id: id,
      userId: userId,
      name: name ?? this.name,
      tmuxSessionName: tmuxSessionName,
      projectPath: projectPath,
      githubRepoId: githubRepoId,
      worktreeBranch: worktreeBranch,
      folderId: folderId,
      profileId: profileId,
      terminalType: terminalType,
      agentProvider: agentProvider,
      agentExitState: agentExitState ?? this.agentExitState,
      agentExitCode: agentExitCode ?? this.agentExitCode,
      agentExitedAt: agentExitedAt ?? this.agentExitedAt,
      agentRestartCount: agentRestartCount ?? this.agentRestartCount,
      agentActivityStatus: agentActivityStatus ?? this.agentActivityStatus,
      typeMetadata: typeMetadata,
      parentSessionId: parentSessionId,
      status: status ?? this.status,
      pinned: pinned ?? this.pinned,
      tabOrder: tabOrder ?? this.tabOrder,
      lastActivityAt: lastActivityAt ?? this.lastActivityAt,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}
