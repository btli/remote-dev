import '../../application/ports/agent_cli_port.dart';
import '../../application/ports/api_client_port.dart';

class AgentCliApi implements AgentCliPort {
  AgentCliApi(this._client);
  final ApiClientPort _client;

  /// Maps provider id → display label. Mirrors the labels used in the PWA
  /// (`src/services/agent-cli-service.ts`).
  static const Map<String, String> _labels = {
    'claude': 'Claude Code',
    'codex': 'OpenAI Codex',
    'gemini': 'Gemini CLI',
    'opencode': 'OpenCode',
  };

  @override
  Future<List<InstalledAgent>> listInstalled() async {
    final raw = await _client.get('/api/agent-cli/status');
    if (raw is! Map<String, dynamic>) return const [];
    final statuses = raw['statuses'];
    if (statuses is! List) return const [];
    final out = <InstalledAgent>[];
    for (final entry in statuses) {
      if (entry is! Map) continue;
      final provider = entry['provider'];
      final installed = entry['installed'];
      if (provider is! String) continue;
      if (installed != true) continue;
      final label = _labels[provider];
      if (label == null) continue;
      out.add(InstalledAgent(provider: provider, label: label));
    }
    return out;
  }
}
