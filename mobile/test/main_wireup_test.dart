import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/app.dart';
import 'package:remote_dev/application/ports/server_config_store.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/main.dart' show buildServerScopedOverrides;
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show serverConfigStoreProvider;

class _StubStore extends Mock implements ServerConfigStore {
  @override
  Future<List<ServerConfig>> loadAll() async => const [];

  @override
  Future<ServerConfig?> loadActive() async => null;
}

void main() {
  testWidgets('RemoteDevApp boots with main wire-up overrides applied',
      (tester) async {
    // Apply the same overrides main.dart uses; with no active server,
    // the server picker is the initial route. The picker doesn't consume
    // the API providers so no override should fire NoActiveServerError
    // at boot.
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          serverConfigStoreProvider.overrideWithValue(_StubStore()),
          ...buildServerScopedOverrides(),
        ],
        child: const RemoteDevApp(),
      ),
    );

    // Pump once to let the first frame render. We avoid pumpAndSettle
    // because some downstream FutureProviders may not resolve in the
    // happy-path test runner (e.g. without a real network stack), and
    // we only care that boot doesn't throw.
    await tester.pump();
    expect(tester.takeException(), isNull);

    // One more pump to let the empty server picker resolve.
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('No servers yet.'), findsOneWidget);
  });
}
