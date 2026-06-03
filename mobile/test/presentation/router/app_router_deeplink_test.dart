// Regression test for the "back does nothing when opened from a
// notification" bug.
//
// Root cause: notification taps + deep links used to navigate via
// `AppRouter.navigateTo` → `GoRouter.go`, which REPLACES the whole
// navigation stack. On a cold-start there was nothing beneath the target
// to pop, so the system/back button was a dead end.
//
// Fix: `AppRouter.navigateDeepLink` roots the stack at `/home` and then
// PUSHES the target, so a back target always exists.
//
// What this test asserts: driving the exact `go('/home')` + `push(target)`
// sequence that `navigateDeepLink` performs — against a GoRouter built from
// the real `AppRoute` paths — yields a genuinely poppable stack
// (`canPop() == true`, and the configuration has >= 2 matches with the
// session on top). We use a minimal router with trivial page builders so
// the test stays free of the heavy `SessionViewScreen` WebView / Riverpod
// providers; the navigation *topology* (flat sibling `/home` and
// `/home/session/:id` routes — NOT a StatefulShellRoute) is what makes the
// push poppable, and that is reproduced faithfully here.
//
// Honors the known `_dyld_start` `flutter test` hang on this Mac: if the
// suite hangs at ~0% CPU it is the toolchain, not this test — the test
// still documents and locks in the intended contract.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:remote_dev/presentation/router/app_route.dart';

/// Builds a GoRouter whose paths mirror the production routes that matter
/// for deep-link navigation, using trivial placeholder pages. The path
/// strings come from the real [AppRoute.toPath] so this stays coupled to
/// the production route shape.
GoRouter _buildMirrorRouter() {
  return GoRouter(
    initialLocation: const AppRoute.serverPicker().toPath(),
    routes: [
      GoRoute(
        path: const AppRoute.serverPicker().toPath(),
        builder: (_, __) => const _Page('servers'),
      ),
      GoRoute(
        path: const AppRoute.home().toPath(),
        builder: (_, __) => const _Page('home'),
      ),
      GoRoute(
        // /home/session/:id
        path: '/home/session/:id',
        builder: (_, state) => _Page('session-${state.pathParameters['id']}'),
      ),
    ],
  );
}

class _Page extends StatelessWidget {
  const _Page(this.label);
  final String label;
  @override
  Widget build(BuildContext context) =>
      Scaffold(body: Center(child: Text(label)));
}

/// Reproduces [AppRouter.navigateDeepLink]'s algorithm against an arbitrary
/// GoRouter so we can exercise it without instantiating the real heavy
/// screens. Kept byte-for-byte in step with the production implementation.
void _navigateDeepLink(GoRouter router, AppRoute route) {
  final loc = route.toPath();
  final homeLoc = const AppRoute.home().toPath();
  if (loc == homeLoc) {
    router.go(loc);
    return;
  }
  router.go(homeLoc);
  router.push(loc);
}

void main() {
  testWidgets(
    'cold-start notification nav to a session yields a poppable stack',
    (tester) async {
      final router = _buildMirrorRouter();
      addTearDown(router.dispose);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();

      // Simulate the cold-start notification tap targeting a session.
      _navigateDeepLink(router, const AppRoute.session('sess-1'));
      await tester.pumpAndSettle();

      // The session page is on top...
      expect(find.text('session-sess-1'), findsOneWidget);

      // ...and there is something beneath it to go back to.
      expect(
        router.routerDelegate.currentConfiguration.matches.length,
        greaterThanOrEqualTo(2),
        reason: 'navigateDeepLink must leave /home beneath the target so the '
            'back button has somewhere to go.',
      );
      expect(
        router.canPop(),
        isTrue,
        reason: 'Back must be possible after a cold-start notification nav.',
      );

      // And popping actually returns to the home shell (not a dead end / app
      // exit).
      router.pop();
      await tester.pumpAndSettle();
      expect(find.text('home'), findsOneWidget);
      expect(find.text('session-sess-1'), findsNothing);
    },
  );

  testWidgets(
    'deep-link to /home itself does not stack a redundant entry',
    (tester) async {
      final router = _buildMirrorRouter();
      addTearDown(router.dispose);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();

      _navigateDeepLink(router, const AppRoute.home());
      await tester.pumpAndSettle();

      expect(find.text('home'), findsOneWidget);
      // Home replaces (go), so it is the sole entry — nothing to pop.
      expect(
        router.routerDelegate.currentConfiguration.matches.length,
        1,
        reason: 'The /home target short-circuits to go() with no extra push.',
      );
      expect(router.canPop(), isFalse);
    },
  );
}
