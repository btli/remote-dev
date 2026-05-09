import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/profile/account_screen.dart';

void main() {
  testWidgets('AccountScreen renders title and placeholder body',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: AccountScreen()),
    );

    expect(find.text('Account'), findsOneWidget);
    expect(
      find.text('Account details — Phase 5 fills this in.'),
      findsOneWidget,
    );
  });
}
