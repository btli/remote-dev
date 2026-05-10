import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/domain/channel.dart';
import 'package:remote_dev/domain/notification.dart';
import 'package:remote_dev/domain/session_summary.dart';
import 'package:remote_dev/infrastructure/api/channels_api.dart';
import 'package:remote_dev/infrastructure/api/notifications_api.dart';
import 'package:remote_dev/infrastructure/api/sessions_api.dart';
import 'package:remote_dev/presentation/screens/channels/channels_tab_screen.dart';
import 'package:remote_dev/presentation/screens/notifications/notifications_tab_screen.dart';
import 'package:remote_dev/presentation/screens/sessions/sessions_tab_screen.dart';
import 'package:remote_dev/presentation/screens/shell/adaptive_bottom_bar.dart';
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

class _FakeChannelsApi extends Fake implements ChannelsApi {
  _FakeChannelsApi(this._channels);
  final List<Channel> _channels;

  @override
  Future<List<Channel>> list() async => _channels;

  @override
  Future<void> archive(String id) async {}
}

void main() {
  Widget wrap(
    Widget child, {
    List<SessionSummary>? sessions,
    List<Channel>? channels,
  }) =>
      ProviderScope(
        overrides: [
          sessionsApiProvider.overrideWithValue(
            _FakeSessionsApi(sessions ?? const []),
          ),
          notificationsApiProvider.overrideWithValue(_FakeNotificationsApi()),
          channelsApiProvider.overrideWithValue(
            _FakeChannelsApi(channels ?? const []),
          ),
        ],
        child: MaterialApp(home: child),
      );

  testWidgets('renders 4 tab labels', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    expect(find.text('Sessions'), findsWidgets);
    expect(find.text('Channels'), findsWidgets);
    // 'Notifications' appears in bottom-nav label + AppBar of NotificationsTabScreen.
    expect(find.text('Notifications'), findsWidgets);
    // 'Profile' appears in bottom-nav label + AppBar of ProfileTabScreen.
    expect(find.text('Profile'), findsWidgets);
  });

  testWidgets('initial body is sessions tab (empty state)', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    expect(find.text('No sessions yet'), findsOneWidget);
  });

  testWidgets('tap Channels switches body to ChannelsTabScreen',
      (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Channels').first);
    await tester.pumpAndSettle();
    expect(find.text('No channels yet'), findsOneWidget);
  });

  testWidgets('tap Notifications switches body', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Notifications').first);
    await tester.pumpAndSettle();
    expect(find.text('No notifications'), findsOneWidget);
  });

  testWidgets('tap Profile switches body to ProfileTabScreen', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Profile').first);
    await tester.pumpAndSettle();
    // ProfileTabScreen renders its 5 settings rows.
    expect(find.text('Account'), findsOneWidget);
    expect(find.text('GitHub accounts'), findsOneWidget);
    expect(find.text('Appearance'), findsOneWidget);
    expect(find.text('Servers'), findsOneWidget);
    expect(find.text('About'), findsOneWidget);
  });

  testWidgets(
    'initialTab=notifications opens HomeShell on the notifications tab',
    (tester) async {
      await tester.pumpWidget(
        wrap(const HomeShell(initialTab: HomeTab.notifications)),
      );
      await tester.pumpAndSettle();
      // NotificationsTabScreen empty-state copy is visible immediately.
      expect(find.text('No notifications'), findsOneWidget);
      // Sessions empty-state should NOT be visible — only the active tab
      // mounts its primary content.
      expect(find.text('No sessions yet'), findsNothing);
    },
  );

  testWidgets(
    'initialTab=channels opens HomeShell on the channels tab',
    (tester) async {
      await tester.pumpWidget(
        wrap(const HomeShell(initialTab: HomeTab.channels)),
      );
      await tester.pumpAndSettle();
      expect(find.text('No channels yet'), findsOneWidget);
      expect(find.text('No sessions yet'), findsNothing);
    },
  );

  testWidgets(
    'system back on non-default tab switches to sessions tab '
    'and consumes the pop',
    (tester) async {
      await tester.pumpWidget(
        wrap(const HomeShell(initialTab: HomeTab.profile)),
      );
      await tester.pumpAndSettle();
      // Profile tab is mounted on entry.
      expect(find.text('Account'), findsOneWidget);
      expect(find.text('No sessions yet'), findsNothing);

      // Simulate Android system back gesture. PopScope.canPop is false on
      // non-default tabs, so the route is NOT popped — onPopInvokedWithResult
      // fires and HomeShell switches its IndexedStack back to sessions.
      final popped = await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      // The pop was consumed (not bubbled up to the navigator), so
      // handlePopRoute reports true (route handled) but HomeShell is still
      // mounted with the sessions tab active.
      expect(popped, isTrue);
      expect(find.text('No sessions yet'), findsOneWidget);
      // Profile-only content is no longer the active tab body.
      expect(find.byType(HomeShell), findsOneWidget);
    },
  );

  testWidgets(
    'system back on sessions tab does NOT switch tabs (allows app exit)',
    (tester) async {
      await tester.pumpWidget(wrap(const HomeShell()));
      await tester.pumpAndSettle();
      expect(find.text('No sessions yet'), findsOneWidget);

      // On the default tab PopScope.canPop is true, so the system handles
      // the pop. In a single-route MaterialApp test the navigator can't
      // actually pop the root, but the key behaviour is: HomeShell does
      // NOT trap the gesture and stays on sessions.
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(find.text('No sessions yet'), findsOneWidget);
      expect(find.byType(HomeShell), findsOneWidget);
    },
  );
}
