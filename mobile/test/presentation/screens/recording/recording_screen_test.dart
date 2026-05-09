import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/recording/recording_screen.dart';

/// Smoke test: the recording screen mounts and renders the native AppBar.
///
/// We deliberately do NOT call `pumpAndSettle` — InAppWebView's platform
/// channel cannot be exercised in widget tests. The AppBar is the part of
/// the widget tree we care about for P5.3, so verifying it mounts is
/// sufficient for the unit test layer.
void main() {
  testWidgets('RecordingScreen mounts with the recording AppBar',
      (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: RecordingScreen(recordingId: 'test-rec'),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Recording'), findsAtLeast(1));
    expect(find.byIcon(Icons.arrow_back), findsOneWidget);
  });
}
