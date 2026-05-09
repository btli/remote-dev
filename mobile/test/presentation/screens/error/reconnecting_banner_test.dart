import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/error/reconnecting_banner.dart';

void main() {
  testWidgets('renders Reconnecting label', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: ReconnectingBanner()),
      ),
    );

    expect(find.text('Reconnecting…'), findsOneWidget);
  });

  testWidgets('without onRetry: no Retry button', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: ReconnectingBanner()),
      ),
    );

    expect(find.text('Retry'), findsNothing);
  });

  testWidgets('with onRetry: tap fires callback', (tester) async {
    var retryCount = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReconnectingBanner(onRetry: () => retryCount++),
        ),
      ),
    );

    expect(find.text('Retry'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pump();

    expect(retryCount, 1);
  });
}
