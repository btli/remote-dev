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

  testWidgets('tapping a chip refetches with the right filter',
      (tester) async {
    final filterCalls = <String?>[];
    when(() => api.list(filter: any(named: 'filter'))).thenAnswer(
      (invocation) async {
        filterCalls.add(invocation.namedArguments[#filter] as String?);
        return const <AppNotification>[];
      },
    );

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();
    expect(filterCalls.last, 'all');

    // Tap the Unread chip.
    await tester.tap(find.text('Unread'));
    await tester.pumpAndSettle();
    expect(filterCalls.last, 'unread');

    // Tap the Mentions chip.
    await tester.tap(find.text('Mentions'));
    await tester.pumpAndSettle();
    expect(filterCalls.last, 'mentions');
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
}
