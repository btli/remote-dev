import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/domain/session_summary.dart';
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

  Finder pipWithColor(Color color) => find.byWidgetPredicate((w) {
        if (w is! Container) return false;
        final dec = w.decoration;
        if (dec is! BoxDecoration) return false;
        return dec.shape == BoxShape.circle && dec.color == color;
      });

  testWidgets('renders subagent pip in violet with Subagent label',
      (tester) async {
    await tester.pumpWidget(
      wrap(const ActivityPip(activity: SessionActivity.subagent)),
    );
    await tester.pumpAndSettle();
    expect(pipWithColor(const Color(0xFFBB9AF7)), findsOneWidget);
    expect(
      tester.widget<Tooltip>(find.byType(Tooltip)).message,
      'Subagent',
    );
  });

  testWidgets('renders compacting pip in blue with Compacting label',
      (tester) async {
    await tester.pumpWidget(
      wrap(const ActivityPip(activity: SessionActivity.compacting)),
    );
    await tester.pumpAndSettle();
    expect(pipWithColor(const Color(0xFF7AA2F7)), findsOneWidget);
    expect(
      tester.widget<Tooltip>(find.byType(Tooltip)).message,
      'Compacting',
    );
  });

  testWidgets('renders ended pip in idle grey with Ended label',
      (tester) async {
    await tester.pumpWidget(
      wrap(const ActivityPip(activity: SessionActivity.ended)),
    );
    await tester.pumpAndSettle();
    expect(pipWithColor(const Color(0xFF565F89)), findsOneWidget);
    expect(
      tester.widget<Tooltip>(find.byType(Tooltip)).message,
      'Ended',
    );
  });

  test('AgentActivityStatus.toSessionActivity maps every status', () {
    expect(
      AgentActivityStatus.running.toSessionActivity(),
      SessionActivity.running,
    );
    expect(
      AgentActivityStatus.waiting.toSessionActivity(),
      SessionActivity.waiting,
    );
    expect(
      AgentActivityStatus.error.toSessionActivity(),
      SessionActivity.error,
    );
    expect(
      AgentActivityStatus.subagent.toSessionActivity(),
      SessionActivity.subagent,
    );
    expect(
      AgentActivityStatus.compacting.toSessionActivity(),
      SessionActivity.compacting,
    );
    expect(
      AgentActivityStatus.ended.toSessionActivity(),
      SessionActivity.ended,
    );
    expect(
      AgentActivityStatus.idle.toSessionActivity(),
      SessionActivity.idle,
    );
    expect(
      AgentActivityStatus.none.toSessionActivity(),
      SessionActivity.idle,
    );
  });

  group('parseActivityArgs (onActivity bridge payload)', () {
    // The bridge sends `notifyToNative("onActivity", { state })` — an OBJECT.
    // flutter_inappwebview JSON-encodes args JS-side and JSON-decodes them
    // Dart-side, so the handler receives `[{state: <s>}]`, a decoded Map.
    // A naive `args.first.toString()` would yield `"{state: running}"` and
    // never match the switch — coercing every live transition to Idle.
    test('reads the state field from the decoded Map (object payload)', () {
      expect(
        parseActivityArgs([
          {'state': 'subagent'},
        ]),
        SessionActivity.subagent,
      );
      expect(
        parseActivityArgs([
          {'state': 'compacting'},
        ]),
        SessionActivity.compacting,
      );
      expect(
        parseActivityArgs([
          {'state': 'running'},
        ]),
        SessionActivity.running,
      );
      expect(
        parseActivityArgs([
          {'state': 'ended'},
        ]),
        SessionActivity.ended,
      );
    });

    test('tolerates a bare-string arg defensively', () {
      expect(parseActivityArgs(['running']), SessionActivity.running);
      expect(parseActivityArgs(['waiting']), SessionActivity.waiting);
    });

    test('falls back to idle for empty / null / unknown args', () {
      expect(parseActivityArgs([]), SessionActivity.idle);
      expect(parseActivityArgs([null]), SessionActivity.idle);
      expect(
        parseActivityArgs([
          {'state': 'bogus'},
        ]),
        SessionActivity.idle,
      );
      expect(
        parseActivityArgs([
          {'no_state_key': 'running'},
        ]),
        SessionActivity.idle,
      );
    });
  });

  testWidgets('tap on title area fires onTap', (tester) async {
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
    // Tap the session-name text directly so we hit the InkWell that wraps
    // the project · session label rather than the leading back-button.
    await tester.tap(find.text('s'));
    expect(taps, 1);
  });

  testWidgets('shows leading back button', (tester) async {
    await tester.pumpWidget(
      wrap(
        const SessionStatusBar(
          projectName: 'p',
          sessionName: 's',
          activity: SessionActivity.idle,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.arrow_back), findsOneWidget);
  });

  testWidgets('back button fires onBack when supplied', (tester) async {
    var backs = 0;
    await tester.pumpWidget(
      wrap(
        SessionStatusBar(
          projectName: 'p',
          sessionName: 's',
          activity: SessionActivity.idle,
          onBack: () => backs++,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.arrow_back));
    expect(backs, 1);
  });
}
