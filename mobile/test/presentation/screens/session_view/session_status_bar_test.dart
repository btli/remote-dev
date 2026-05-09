import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/session_view/activity_pip.dart';
import 'package:remote_dev/presentation/screens/session_view/session_status_bar.dart';

void main() {
  Widget wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

  testWidgets('renders project · session', (tester) async {
    await tester.pumpWidget(
      wrap(
        const SessionStatusBar(
          projectName: 'remote-dev',
          sessionName: 'feat/mobile-phase-2',
          activity: SessionActivity.running,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('remote-dev'), findsOneWidget);
    expect(find.text('feat/mobile-phase-2'), findsOneWidget);
  });

  testWidgets('omits project separator when projectName is null',
      (tester) async {
    await tester.pumpWidget(
      wrap(
        const SessionStatusBar(
          projectName: null,
          sessionName: 'standalone',
          activity: SessionActivity.idle,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('·'), findsNothing);
    expect(find.text('standalone'), findsOneWidget);
  });

  testWidgets('renders activity pip', (tester) async {
    await tester.pumpWidget(
      wrap(
        const SessionStatusBar(
          projectName: 'p',
          sessionName: 's',
          activity: SessionActivity.running,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(ActivityPip), findsOneWidget);
  });

  testWidgets('tap fires onTap', (tester) async {
    var taps = 0;
    await tester.pumpWidget(
      wrap(
        SessionStatusBar(
          projectName: 'p',
          sessionName: 's',
          activity: SessionActivity.idle,
          onTap: () => taps++,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byType(SessionStatusBar));
    expect(taps, 1);
  });
}
