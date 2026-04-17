import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:remote_dev/presentation/providers/server_config_providers.dart';
import 'package:remote_dev/presentation/screens/server/add_server_screen.dart';

void main() {
  testWidgets('defaults to manual setup while QR onboarding is disabled', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sharedPreferencesProvider.overrideWithValue(prefs),
        ],
        child: const MaterialApp(
          home: AddServerScreen(),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.text('Open Scanner'), findsNothing);
    expect(find.text('Scan QR Code'), findsNothing);
    expect(find.text('Authentication'), findsOneWidget);
    expect(find.text('Server Name (optional)'), findsOneWidget);
  });
}
