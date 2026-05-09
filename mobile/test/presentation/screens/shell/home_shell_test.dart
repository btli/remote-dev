import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/domain/notification.dart';
import 'package:remote_dev/domain/session_summary.dart';
import 'package:remote_dev/infrastructure/api/notifications_api.dart';
import 'package:remote_dev/infrastructure/api/sessions_api.dart';
import 'package:remote_dev/presentation/screens/notifications/notifications_tab_screen.dart';
import 'package:remote_dev/presentation/screens/sessions/sessions_tab_screen.dart';
import 'package:remote_dev/presentation/screens/shell/home_shell.dart';

class _FakeSessionsApi extends Fake implements SessionsApi {
  _FakeSessionsApi(this._sessions);
  final List<SessionSummary> _sessions;

  @override
  Future<List<SessionSummary>> list() async => _sessions;

  @override
  Future<void> suspend(String id) async {}

  @override
  Future<void> close(String id) async {}
}

class _FakeNotificationsApi extends Fake implements NotificationsApi {
  @override
  Future<List<AppNotification>> list({String? filter}) async => const [];

  @override
  Future<void> markRead(List<String> ids) async {}

  @override
  Future<void> dismiss(String id) async {}

  @override
  Future<void> markAllRead() async {}
}

void main() {
  Widget wrap(Widget child, {List<SessionSummary>? sessions}) => ProviderScope(
        overrides: [
          sessionsApiProvider.overrideWithValue(
            _FakeSessionsApi(sessions ?? const []),
          ),
          notificationsApiProvider.overrideWithValue(_FakeNotificationsApi()),
        ],
        child: MaterialApp(home: child),
      );

  testWidgets('renders 4 tab labels', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    expect(find.text('Sessions'), findsWidgets);
    expect(find.text('Channels'), findsOneWidget);
    // 'Notifications' now appears both as a bottom-nav label and as the
    // NotificationsTabScreen AppBar title (rendered in the IndexedStack).
    expect(find.text('Notifications'), findsWidgets);
    expect(find.text('Profile'), findsOneWidget);
  });

  testWidgets('initial body is sessions tab (empty state)', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    expect(find.text('No sessions yet'), findsOneWidget);
  });

  testWidgets('tap Channels switches body', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Channels'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Channels — coming in Phase 4'), findsOneWidget);
  });

  testWidgets('tap Notifications switches body', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    // The bottom-nav label is the only 'Notifications' Text not inside an
    // AppBar; tapping it activates the tab.
    await tester.tap(find.text('Notifications').first);
    await tester.pumpAndSettle();
    // Empty state from the live NotificationsTabScreen.
    expect(find.text('No notifications'), findsOneWidget);
  });

  testWidgets('tap Profile switches body', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Profile'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Profile — coming in Phase 4'), findsOneWidget);
  });
}
