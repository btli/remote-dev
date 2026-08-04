import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/api_client_port.dart';
import 'package:remote_dev/infrastructure/api/agent_cli_api.dart';

class _MockClient extends Mock implements ApiClientPort {}

void main() {
  test('maps an installed Cursor CLI to its picker label', () async {
    final client = _MockClient();
    when(() => client.get('/api/agent-cli/status')).thenAnswer(
      (_) async => {
        'statuses': [
          {'provider': 'cursor', 'installed': true, 'command': 'agent'},
        ],
      },
    );

    final installed = await AgentCliApi(client).listInstalled();

    expect(installed, hasLength(1));
    expect(installed.single.provider, 'cursor');
    expect(installed.single.label, 'Cursor');
  });

  test('maps an installed Kimi CLI to its picker label', () async {
    final client = _MockClient();
    when(() => client.get('/api/agent-cli/status')).thenAnswer(
      (_) async => {
        'statuses': [
          {'provider': 'kimi', 'installed': true, 'command': 'kimi'},
        ],
      },
    );

    final installed = await AgentCliApi(client).listInstalled();

    expect(installed, hasLength(1));
    expect(installed.single.provider, 'kimi');
    expect(installed.single.label, 'Kimi');
  });
}
