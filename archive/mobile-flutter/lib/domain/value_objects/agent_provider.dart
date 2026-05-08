/// AI agent provider types supported by Remote Dev.
enum AgentProvider {
  claude('claude', 'Claude Code', 'claude'),
  codex('codex', 'OpenAI Codex', 'codex'),
  gemini('gemini', 'Gemini CLI', 'gemini'),
  opencode('opencode', 'OpenCode', 'opencode'),
  none('none', 'None', '');

  const AgentProvider(this.value, this.displayName, this.command);
  final String value;
  final String displayName;
  final String command;

  static AgentProvider fromString(String? value) => switch (value) {
        'claude' => AgentProvider.claude,
        'codex' => AgentProvider.codex,
        'gemini' => AgentProvider.gemini,
        'opencode' => AgentProvider.opencode,
        _ => AgentProvider.none,
      };

  bool get isAgent => this != none;
}

/// Agent exit state machine.
enum AgentExitState {
  running('running'),
  exited('exited'),
  restarting('restarting'),
  closed('closed');

  const AgentExitState(this.value);
  final String value;

  static AgentExitState? fromString(String? value) => switch (value) {
        'running' => AgentExitState.running,
        'exited' => AgentExitState.exited,
        'restarting' => AgentExitState.restarting,
        'closed' => AgentExitState.closed,
        _ => null,
      };
}

/// Real-time agent activity status (from WebSocket broadcasts).
enum AgentActivityStatus {
  running('running'),
  waiting('waiting'),
  idle('idle'),
  error('error'),
  compacting('compacting'),
  ended('ended');

  const AgentActivityStatus(this.value);
  final String value;

  static AgentActivityStatus? fromString(String? value) => switch (value) {
        'running' => AgentActivityStatus.running,
        'waiting' => AgentActivityStatus.waiting,
        'idle' => AgentActivityStatus.idle,
        'error' => AgentActivityStatus.error,
        'compacting' => AgentActivityStatus.compacting,
        'ended' => AgentActivityStatus.ended,
        _ => null,
      };
}
