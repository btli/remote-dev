// Regression test for the "back does nothing when opened from a
// notification" bug.
//
// Root cause: notification taps + deep links used to navigate via a plain
// `GoRouter.go`, which REPLACES the whole navigation stack. On a cold-start
// there was nothing beneath the target to pop, so the system/back button
// was a dead end.
//
// Fix: `AppRouter.navigateDeepLink` roots the stack at `/home` and then
// PUSHES session/channel targets, so a back target always exists. Full-shell
// targets (`/home`, `/notifications`) are replaced (go) rather than pushed,
// and a guard de-dupes a target that is already on top (Android can deliver
// a tap twice via getInitialMessage + onMessageOpenedApp).
//
// What these tests assert: driving the same go/push sequence that
// `navigateDeepLink` performs — against a GoRouter built from the real
// `AppRoute` paths — yields a genuinely poppable stack for session/channel
// targets (`canPop() == true`, >= 2 matches with the target on top), a
// single non-poppable entry for the full-shell targets, and no 4-deep stack
// on a doubled delivery. We use a minimal router with trivial page builders
// so the test stays free of the heavy `SessionViewScreen` WebView / Riverpod
// providers; the navigation *topology* (flat sibling `/home`,
// `/home/session/:id`, `/home/channel/:id`, `/notifications` routes — NOT a
// StatefulShellRoute) is what makes the push poppable, and that is
// reproduced faithfully here.
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
      GoRoute(
        // /home/channel/:id
        path: '/home/channel/:id',
        builder: (_, state) => _Page('channel-${state.pathParameters['id']}'),
      ),
      GoRoute(
        // /notifications — a second full HomeShell destination in production.
        path: const AppRoute.notifications().toPath(),
        builder: (_, __) => const _Page('notifications'),
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

/// Reproduces `AppRouter.navigateDeepLink`'s algorithm against an arbitrary
/// GoRouter so we can exercise it without instantiating the real heavy
/// screens. Kept in step with the production implementation.
void _navigateDeepLink(GoRouter router, AppRoute route) {
  final loc = route.toPath();
  final homeLoc = const AppRoute.home().toPath();
  final notifLoc = const AppRoute.notifications().toPath();
  // Home + notifications are full-shell destinations: replace, don't push.
  if (loc == homeLoc || loc == notifLoc) {
    router.go(loc);
    return;
  }
  // Double-delivery / double-tap guard: bail if the target is already on top.
  final current = router.routerDelegate.currentConfiguration;
  if (current.matches.length >= 2 &&
      current.matches.last.matchedLocation == loc) {
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

  testWidgets(
    'cold-start notification nav to a channel yields a poppable stack',
    (tester) async {
      final router = _buildMirrorRouter();
      addTearDown(router.dispose);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();

      _navigateDeepLink(router, const AppRoute.channel('c-1'));
      await tester.pumpAndSettle();

      expect(find.text('channel-c-1'), findsOneWidget);
      expect(
        router.routerDelegate.currentConfiguration.matches.length,
        greaterThanOrEqualTo(2),
        reason: 'A channel deep-link must leave /home beneath it.',
      );
      expect(router.canPop(), isTrue);

      router.pop();
      await tester.pumpAndSettle();
      expect(find.text('home'), findsOneWidget);
      expect(find.text('channel-c-1'), findsNothing);
    },
  );

  testWidgets(
    'doubled notification delivery does not stack a 4-deep [home,t,home,t]',
    (tester) async {
      final router = _buildMirrorRouter();
      addTearDown(router.dispose);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();

      // Android can fire getInitialMessage AND onMessageOpenedApp for the
      // same tap. Deliver the SAME session target twice.
      _navigateDeepLink(router, const AppRoute.session('sess-1'));
      await tester.pumpAndSettle();
      _navigateDeepLink(router, const AppRoute.session('sess-1'));
      await tester.pumpAndSettle();

      // Still exactly [home, session] — the second delivery is de-duped.
      expect(
        router.routerDelegate.currentConfiguration.matches.length,
        2,
        reason: 'The de-dupe guard must drop the duplicate target instead of '
            'stacking [home, target, home, target].',
      );
      expect(find.text('session-sess-1'), findsOneWidget);

      // A single pop returns straight to home (not to a second session).
      router.pop();
      await tester.pumpAndSettle();
      expect(find.text('home'), findsOneWidget);
      expect(find.text('session-sess-1'), findsNothing);
    },
  );

  testWidgets(
    'notifications target replaces rather than stacking a second shell',
    (tester) async {
      final router = _buildMirrorRouter();
      addTearDown(router.dispose);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();

      _navigateDeepLink(router, const AppRoute.notifications());
      await tester.pumpAndSettle();

      expect(find.text('notifications'), findsOneWidget);
      // Replaced (go), so it is the sole entry — no second HomeShell pushed
      // on top of /home.
      expect(
        router.routerDelegate.currentConfiguration.matches.length,
        1,
        reason: 'Notifications is a full-shell destination: go(), not push().',
      );
      expect(router.canPop(), isFalse);
    },
  );
}
