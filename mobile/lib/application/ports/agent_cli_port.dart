/// An AI coding agent CLI that is installed and runnable on the server.
class InstalledAgent {
  const InstalledAgent({required this.provider, required this.label});

  /// Provider id, e.g. `claude`, `codex`, `gemini`, `opencode`.
  final String provider;

  /// Human-readable label shown in pickers, e.g. `Claude Code`.
  final String label;
}

/// Port for querying which agent CLIs the active server reports as installed.
abstract class AgentCliPort {
  /// Returns the subset of supported providers whose CLI binary is present on
  /// the server (`installed == true` in `GET /api/agent-cli/status`).
  Future<List<InstalledAgent>> listInstalled();
}
