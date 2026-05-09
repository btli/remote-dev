import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/error/version_mismatch_screen.dart';

void main() {
  testWidgets('renders title and version numbers', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: VersionMismatchScreen(
          expectedVersion: 3,
          actualVersion: 2,
          onOpenStore: () {},
        ),
      ),
    );

    expect(find.text('Update Remote Dev'), findsOneWidget);
    expect(find.textContaining('v2'), findsOneWidget);
    expect(find.textContaining('v3'), findsOneWidget);
    expect(find.text('Open store'), findsOneWidget);
  });

  testWidgets('tap Open store fires onOpenStore', (tester) async {
    var openCount = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: VersionMismatchScreen(
          expectedVersion: 3,
          actualVersion: 2,
          onOpenStore: () => openCount++,
        ),
      ),
    );

    await tester.tap(find.text('Open store'));
    await tester.pump();

    expect(openCount, 1);
  });

  testWidgets('renders system_update icon', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: VersionMismatchScreen(
          expectedVersion: 5,
          actualVersion: 4,
          onOpenStore: () {},
        ),
      ),
    );

    expect(find.byIcon(Icons.system_update), findsOneWidget);
  });
}
