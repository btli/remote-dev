import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/app.dart';
import 'package:remote_dev/application/ports/server_config_store.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show serverConfigStoreProvider;

class _StubStore extends Mock implements ServerConfigStore {
  @override
  Future<List<ServerConfig>> loadAll() async => const [];

  @override
  Future<ServerConfig?> loadActive() async => null;
}

void main() {
  testWidgets('app boots and shows the empty server picker', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          serverConfigStoreProvider.overrideWithValue(_StubStore()),
        ],
        child: const RemoteDevApp(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('No servers yet.'), findsOneWidget);
  });
}
