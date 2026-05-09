import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/error/server_unreachable_screen.dart';

void main() {
  testWidgets('renders title and server label', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ServerUnreachableScreen(
          serverLabel: 'https://dev.example.com',
          onRetry: () {},
          onSwitchServer: () {},
        ),
      ),
    );

    expect(find.text("Can't reach server"), findsOneWidget);
    expect(find.text('https://dev.example.com'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    expect(find.text('Switch server'), findsOneWidget);
  });

  testWidgets('tap Retry fires onRetry', (tester) async {
    var retryCount = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: ServerUnreachableScreen(
          serverLabel: 'Work',
          onRetry: () => retryCount++,
          onSwitchServer: () {},
        ),
      ),
    );

    await tester.tap(find.text('Retry'));
    await tester.pump();

    expect(retryCount, 1);
  });

  testWidgets('tap Switch server fires onSwitchServer', (tester) async {
    var switchCount = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: ServerUnreachableScreen(
          serverLabel: 'Work',
          onRetry: () {},
          onSwitchServer: () => switchCount++,
        ),
      ),
    );

    await tester.tap(find.text('Switch server'));
    await tester.pump();

    expect(switchCount, 1);
  });
}
