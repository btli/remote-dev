import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/biometric/biometric_lock_screen.dart';

void main() {
  testWidgets('BiometricLockScreen renders title and authenticate button',
      (tester) async {
    var tapped = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: BiometricLockScreen(onAuthenticate: () => tapped += 1),
      ),
    );

    expect(find.text('Remote Dev locked'), findsOneWidget);
    expect(find.text('Authenticate'), findsOneWidget);
    expect(find.byIcon(Icons.lock_outline), findsOneWidget);

    await tester.tap(find.text('Authenticate'));
    await tester.pumpAndSettle();
    expect(tapped, 1);
  });
}
