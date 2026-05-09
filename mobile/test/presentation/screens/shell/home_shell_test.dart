import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/shell/home_shell.dart';

void main() {
  Widget wrap(Widget child) => ProviderScope(
        child: MaterialApp(home: child),
      );

  testWidgets('renders 4 tab labels', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    expect(find.text('Sessions'), findsOneWidget);
    expect(find.text('Channels'), findsOneWidget);
    expect(find.text('Notifications'), findsOneWidget);
    expect(find.text('Profile'), findsOneWidget);
  });

  testWidgets('initial body is Sessions placeholder', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    expect(find.textContaining('Sessions tab — P2.2'), findsOneWidget);
  });

  testWidgets('tap Channels switches body', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Channels'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Channels — coming in Phase 4'), findsOneWidget);
  });

  testWidgets('tap Notifications switches body', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Notifications'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Notifications — coming in Phase 4'),
      findsOneWidget,
    );
  });

  testWidgets('tap Profile switches body', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Profile'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Profile — coming in Phase 4'), findsOneWidget);
  });
}
