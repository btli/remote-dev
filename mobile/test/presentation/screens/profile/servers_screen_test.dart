import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/profile/servers_screen.dart';

void main() {
  testWidgets('ServersScreen renders title and placeholder body',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: ServersScreen()),
    );

    expect(find.text('Servers'), findsOneWidget);
    expect(
      find.textContaining('Servers — manage in Phase 5'),
      findsOneWidget,
    );
  });
}
