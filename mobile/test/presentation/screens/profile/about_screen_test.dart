import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/profile/about_screen.dart';

void main() {
  testWidgets('AboutScreen renders title and product info', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: AboutScreen()),
    );

    expect(find.text('About'), findsOneWidget);
    expect(find.text('Remote Dev'), findsOneWidget);
    expect(find.text('Phase 4 (development)'), findsOneWidget);
  });
}
