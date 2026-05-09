import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/profile/appearance_screen.dart';

void main() {
  testWidgets('AppearanceScreen renders title and placeholder body',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: AppearanceScreen()),
    );

    expect(find.text('Appearance'), findsOneWidget);
    expect(
      find.text('Appearance — Phase 5 fills this in.'),
      findsOneWidget,
    );
  });
}
