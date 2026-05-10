// Verifies that profile sub-screens reachable via `context.push` from the
// profile tab show the implicit Material AppBar back button (BackButton)
// thanks to `automaticallyImplyLeading: true` (the default) once a route
// is on the back stack.
//
// Sister task B.1 (PR #246/follow-up) switched these sub-routes from
// `context.go` to `context.push`, and remote-dev-q029 audits the AppBars
// to ensure every pushed screen actually surfaces a back-arrow.

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/domain/account.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/infrastructure/api/account_api.dart';
import 'package:remote_dev/presentation/screens/profile/about_screen.dart';
import 'package:remote_dev/presentation/screens/profile/account_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show activeServerProvider;

class _StubAccountApi extends Mock implements AccountApi {}

ServerConfig _server() => ServerConfig(
      id: 'srv-1',
      label: 'My Server',
      url: 'https://rdv.example',
      lastUsedAt: DateTime.utc(2026, 1, 1),
    );

Widget _wrap({required String pushTarget, required Widget target}) {
  final router = GoRouter(
    initialLocation: '/',
    routes: [
      GoRoute(
        path: '/',
        builder: (context, _) => Scaffold(
          appBar: AppBar(title: const Text('root')),
          body: Center(
            child: ElevatedButton(
              onPressed: () => context.push(pushTarget),
              child: const Text('go'),
            ),
          ),
        ),
      ),
      GoRoute(path: pushTarget, builder: (_, __) => target),
    ],
  );
  // AccountScreen reads accountApiProvider + activeServerProvider; both
  // need overrides here or the screen sits in a permanent loading state
  // and `pumpAndSettle` times out before we can locate the BackButton.
  final api = _StubAccountApi();
  when(() => api.me()).thenAnswer(
    (_) async => const Account(email: 'jane@example.com'),
  );
  return ProviderScope(
    overrides: [
      accountApiProvider.overrideWithValue(api),
      activeServerProvider.overrideWith(
        (ref) => SynchronousFuture<ServerConfig?>(_server()),
      ),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
}

void main() {
  testWidgets(
    'AccountScreen reached via context.push shows an implicit back button',
    (tester) async {
      await tester.pumpWidget(
        _wrap(
          pushTarget: '/home/profile/account',
          target: const AccountScreen(),
        ),
      );
      await tester.pumpAndSettle();
      // No back button on the root.
      expect(find.byType(BackButton), findsNothing);

      await tester.tap(find.text('go'));
      await tester.pumpAndSettle();

      // After push the AppBar should auto-imply a leading BackButton.
      expect(find.text('Account'), findsOneWidget);
      expect(find.byType(BackButton), findsOneWidget);
    },
  );

  testWidgets(
    'AboutScreen reached via context.push shows an implicit back button',
    (tester) async {
      await tester.pumpWidget(
        _wrap(
          pushTarget: '/home/profile/about',
          target: const AboutScreen(),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('go'));
      await tester.pumpAndSettle();

      expect(find.text('About'), findsOneWidget);
      expect(find.byType(BackButton), findsOneWidget);
    },
  );

  testWidgets(
    'tapping the implicit back button pops back to the previous route',
    (tester) async {
      await tester.pumpWidget(
        _wrap(
          pushTarget: '/home/profile/account',
          target: const AccountScreen(),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('go'));
      await tester.pumpAndSettle();

      // Sanity check: we're on the pushed route.
      expect(find.text('Account'), findsOneWidget);

      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();

      // Back to root: the "go" button is visible again.
      expect(find.text('go'), findsOneWidget);
    },
  );
}
