import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/profile/github_accounts_screen.dart';

void main() {
  testWidgets('GitHubAccountsScreen renders title and placeholder body',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: GitHubAccountsScreen()),
    );

    expect(find.text('GitHub accounts'), findsOneWidget);
    expect(
      find.text('GitHub accounts — Phase 5 fills this in.'),
      findsOneWidget,
    );
  });
}
