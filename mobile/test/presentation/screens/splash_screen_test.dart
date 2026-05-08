import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/splash/splash_screen.dart';

void main() {
  testWidgets('SplashScreen shows a progress indicator', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: SplashScreen()));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    // Drain the trouble-loading timer so the test ends cleanly.
    await tester.pump(SplashScreen.troubleLoadingDelay);
  });
}
