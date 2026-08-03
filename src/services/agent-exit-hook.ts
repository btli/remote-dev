export interface AgentExitHookOptions {
  sessionId: string;
  tmuxSessionName: string;
  generation: number;
  terminalSocket?: string;
  terminalPort?: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function buildAgentExitCallbackScript(options: AgentExitHookOptions): string {
  const path = `/internal/agent-exit?sessionId=${encodeURIComponent(options.sessionId)}`;
  const url = options.terminalSocket
    ? `http://localhost${path}`
    : `http://localhost:${options.terminalPort ?? "6002"}${path}`;
  const endpoint = options.terminalSocket
    ? `--unix-socket ${shellQuote(options.terminalSocket)} `
    : "";

  return (
    `_RDV_AUTH=$(tmux show-environment -t ${shellQuote(options.tmuxSessionName)} RDV_API_KEY 2>/dev/null) || exit 1; ` +
    'case "$_RDV_AUTH" in RDV_API_KEY=*) export "$_RDV_AUTH" ;; *) exit 1 ;; esac; ' +
    'curl --fail --silent --show-error --output /dev/null ' +
    '--connect-timeout 1 --max-time 2 --retry 3 --retry-delay 1 --retry-max-time 6 --retry-all-errors ' +
    '-X POST -H "Authorization: Bearer $RDV_API_KEY" ' +
    endpoint +
    `"${url}&generation=${options.generation}&exitCode=#{pane_dead_status}&signal=#{pane_dead_signal}"`
  );
}

export function buildAgentExitHookCommand(options: AgentExitHookOptions): string {
  return `run-shell ${shellQuote(buildAgentExitCallbackScript(options))}`;
}
