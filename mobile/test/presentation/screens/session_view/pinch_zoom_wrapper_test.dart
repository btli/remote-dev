import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/session_view/pinch_zoom_wrapper.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('wraps the child', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: PinchZoomWrapper(
          sessionId: 's1',
          onFontSizeChanged: (_) {},
          child: const Text('terminal'),
        ),
      ),
    );
    expect(find.text('terminal'), findsOneWidget);
  });

  testWidgets('restores persisted font size on mount', (tester) async {
    SharedPreferences.setMockInitialValues({'fontSize.s1': 16});
    final reported = <int>[];
    await tester.pumpWidget(
      MaterialApp(
        home: PinchZoomWrapper(
          sessionId: 's1',
          onFontSizeChanged: reported.add,
          child: const SizedBox(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(reported, contains(16));
  });

  testWidgets('clamps restored value into [min, max]', (tester) async {
    SharedPreferences.setMockInitialValues({'fontSize.s1': 50});
    final reported = <int>[];
    await tester.pumpWidget(
      MaterialApp(
        home: PinchZoomWrapper(
          sessionId: 's1',
          onFontSizeChanged: reported.add,
          maxFontSize: 22,
          child: const SizedBox(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(reported, contains(22));
  });
}
