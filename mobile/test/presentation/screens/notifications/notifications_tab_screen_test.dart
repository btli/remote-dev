import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/domain/notification.dart';
import 'package:remote_dev/infrastructure/api/notifications_api.dart';
import 'package:remote_dev/presentation/screens/notifications/notifications_tab_screen.dart';

class _MockNotificationsApi extends Mock implements NotificationsApi {}

Widget _wrap(NotificationsApi api) {
  return ProviderScope(
    overrides: [
      notificationsApiProvider.overrideWithValue(api),
    ],
    child: const MaterialApp(home: NotificationsTabScreen()),
  );
}

AppNotification _notif({
  String id = 'n1',
  String title = 'Title',
  String body = 'Body',
  bool read = false,
  String? sessionId,
  String? channelId,
  String kind = 'default',
  String? type,
}) {
  return AppNotification(
    id: id,
    title: title,
    body: body,
    createdAt: DateTime.utc(2026, 5, 8, 10),
    read: read,
    sessionId: sessionId,
    channelId: channelId,
    kind: kind,
    type: type,
  );
}

void main() {
  late _MockNotificationsApi api;

  setUp(() {
    api = _MockNotificationsApi();
  });

  testWidgets('renders empty state when list is empty', (tester) async {
    when(() => api.list(filter: any(named: 'filter')))
        .thenAnswer((_) async => const <AppNotification>[]);

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    expect(find.text('No notifications'), findsOneWidget);
    expect(find.text('Pull down to refresh.'), findsOneWidget);
  });

  testWidgets('renders rows + filter chips', (tester) async {
    when(() => api.list(filter: any(named: 'filter'))).thenAnswer(
      (_) async => [
        _notif(id: 'n1', title: 'First', body: 'Hello'),
        _notif(id: 'n2', title: 'Second', body: 'World', read: true),
      ],
    );

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    // Filter chips
    expect(find.text('All'), findsOneWidget);
    expect(find.text('Unread'), findsOneWidget);
    expect(find.text('Mentions'), findsOneWidget);

    // Notification rows
    expect(find.text('First'), findsOneWidget);
    expect(find.text('Second'), findsOneWidget);
    expect(find.text('Hello'), findsOneWidget);
    expect(find.text('World'), findsOneWidget);
  });

  testWidgets('tapping a chip filters the same fetched list in-memory',
      (tester) async {
    // The PWA mobile-web tab fetches all notifications once and
    // filters client-side. The chip changes which rows are visible
    // without firing another `list()` call. Build a payload with a
    // mix of read/unread, agent-typed, and `@name`-bodied rows so we
    // can verify all three chips select the right subset.
    var listCalls = 0;
    when(() => api.list(filter: any(named: 'filter'))).thenAnswer((_) async {
      listCalls += 1;
      return [
        _notif(id: 'n-unread-plain', title: 'Plain', body: 'no mention'),
        _notif(
          id: 'n-read-mention',
          title: 'Mention',
          body: '@alice please look',
          read: true,
        ),
        _notif(
          id: 'n-agent-waiting',
          title: '@you are pinged',
          body: 'idle for 5m',
          type: 'agent_waiting',
        ),
      ];
    });

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    // All chip: every row visible.
    expect(find.text('Plain'), findsOneWidget);
    expect(find.text('Mention'), findsOneWidget);
    expect(find.text('@you are pinged'), findsOneWidget);

    // Unread chip: drop the read row.
    await tester.tap(find.text('Unread'));
    await tester.pumpAndSettle();
    expect(find.text('Plain'), findsOneWidget);
    expect(find.text('Mention'), findsNothing);
    expect(find.text('@you are pinged'), findsOneWidget);

    // Mentions chip: keep only `@`-tokened rows, and exclude agent_* types
    // even when their title contains `@`.
    await tester.tap(find.text('Mentions'));
    await tester.pumpAndSettle();
    expect(find.text('Plain'), findsNothing);
    expect(find.text('Mention'), findsOneWidget);
    expect(find.text('@you are pinged'), findsNothing);

    // Filtering happens in-memory — no extra fetches were issued.
    expect(listCalls, 1);
  });

  testWidgets('shows error view + retry on failure', (tester) async {
    when(() => api.list(filter: any(named: 'filter')))
        .thenThrow(Exception('boom'));

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    expect(find.text('Failed to load notifications'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('Mark all read triggers API + refetch', (tester) async {
    var calls = 0;
    when(() => api.list(filter: any(named: 'filter'))).thenAnswer((_) async {
      calls += 1;
      return const <AppNotification>[];
    });
    when(() => api.markAllRead()).thenAnswer((_) async {});

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();
    expect(calls, 1);

    await tester.tap(find.text('Mark all read'));
    await tester.pumpAndSettle();

    verify(() => api.markAllRead()).called(1);
    expect(calls, greaterThanOrEqualTo(2));
  });

  testWidgets('Clear all action is hidden when the list is empty',
      (tester) async {
    when(() => api.list(filter: any(named: 'filter')))
        .thenAnswer((_) async => const <AppNotification>[]);

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    expect(find.text('Clear all'), findsNothing);
    // "Mark all read" stays visible regardless of list size.
    expect(find.text('Mark all read'), findsOneWidget);
  });

  testWidgets('Clear all confirms via dialog then calls dismissAll + refetch',
      (tester) async {
    var calls = 0;
    when(() => api.list(filter: any(named: 'filter'))).thenAnswer((_) async {
      calls += 1;
      return [_notif(id: 'n1', title: 'First', body: 'Hello')];
    });
    when(() => api.dismissAll()).thenAnswer((_) async {});

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();
    expect(calls, 1);

    // The destructive action is now visible because the list is non-empty.
    await tester.tap(find.text('Clear all'));
    await tester.pumpAndSettle();

    // Confirmation dialog content.
    expect(find.text('Clear all notifications?'), findsOneWidget);

    // Confirm by tapping the destructive button inside the dialog.
    // The dialog action shares its label with the AppBar trigger, so
    // disambiguate by widget type (TextButton inside the AlertDialog).
    final confirmButton = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.widgetWithText(TextButton, 'Clear all'),
    );
    expect(confirmButton, findsOneWidget);
    await tester.tap(confirmButton);
    await tester.pumpAndSettle();

    verify(() => api.dismissAll()).called(1);
    expect(calls, greaterThanOrEqualTo(2));
  });

  testWidgets('Clear all cancel dismisses dialog without calling API',
      (tester) async {
    when(() => api.list(filter: any(named: 'filter'))).thenAnswer(
      (_) async => [_notif(id: 'n1', title: 'First', body: 'Hello')],
    );

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Clear all'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    verifyNever(() => api.dismissAll());
  });

  testWidgets('Clear all surfaces a snackbar when dismissAll fails',
      (tester) async {
    when(() => api.list(filter: any(named: 'filter'))).thenAnswer(
      (_) async => [_notif(id: 'n1', title: 'First', body: 'Hello')],
    );
    when(() => api.dismissAll()).thenThrow(Exception('boom'));

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Clear all'));
    await tester.pumpAndSettle();

    final confirmButton = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.widgetWithText(TextButton, 'Clear all'),
    );
    await tester.tap(confirmButton);
    await tester.pumpAndSettle();

    verify(() => api.dismissAll()).called(1);
    expect(find.textContaining('Failed to dismiss all'), findsOneWidget);
  });
}
