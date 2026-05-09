import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:remote_dev/presentation/screens/profile/profile_tab_screen.dart';

Widget _wrap() {
  final router = GoRouter(
    initialLocation: '/',
    routes: [
      GoRoute(path: '/', builder: (_, __) => const ProfileTabScreen()),
      // Stub destinations so taps don't crash.
      GoRoute(
        path: '/home/profile/account',
        builder: (_, __) => const Scaffold(body: Text('account')),
      ),
      GoRoute(
        path: '/home/profile/github',
        builder: (_, __) => const Scaffold(body: Text('github')),
      ),
      GoRoute(
        path: '/home/profile/appearance',
        builder: (_, __) => const Scaffold(body: Text('appearance')),
      ),
      GoRoute(
        path: '/home/profile/servers',
        builder: (_, __) => const Scaffold(body: Text('servers')),
      ),
      GoRoute(
        path: '/home/profile/biometric',
        builder: (_, __) => const Scaffold(body: Text('biometric')),
      ),
      GoRoute(
        path: '/home/profile/about',
        builder: (_, __) => const Scaffold(body: Text('about')),
      ),
    ],
  );

  return ProviderScope(
    child: MaterialApp.router(routerConfig: router),
  );
}

void main() {
  testWidgets('ProfileTabScreen renders title and 6 settings rows',
      (tester) async {
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    expect(find.text('Profile'), findsOneWidget);
    expect(find.text('Account'), findsOneWidget);
    expect(find.text('GitHub accounts'), findsOneWidget);
    expect(find.text('Appearance'), findsOneWidget);
    expect(find.text('Servers'), findsOneWidget);
    expect(find.text('Security'), findsOneWidget);
    expect(find.text('About'), findsOneWidget);
  });

  testWidgets('ProfileTabScreen tapping Security navigates to biometric',
      (tester) async {
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Security'));
    await tester.pumpAndSettle();

    expect(find.text('biometric'), findsOneWidget);
  });

  testWidgets('ProfileTabScreen tapping Account navigates to /home/profile/account',
      (tester) async {
    await tester.pumpWidget(_wrap());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Account'));
    await tester.pumpAndSettle();

    expect(find.text('account'), findsOneWidget);
  });
}
