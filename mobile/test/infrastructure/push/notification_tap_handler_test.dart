import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/infrastructure/push/notification_tap_handler.dart';
import 'package:remote_dev/presentation/router/app_route.dart';
import 'package:remote_dev/presentation/router/app_router.dart';

class _MockRouter extends Mock implements AppRouter {}

void main() {
  setUpAll(() {
    registerFallbackValue(const AppRoute.notifications());
  });

  late _MockRouter router;
  late NotificationTapHandler handler;

  setUp(() {
    router = _MockRouter();
    handler = NotificationTapHandler(router: router);
  });

  test('payload with sessionId routes to SessionRoute', () {
    handler.navigateForPayload({'sessionId': 'sess-1'});
    final captured =
        verify(() => router.navigateTo(captureAny())).captured.single
            as AppRoute;
    expect(captured, isA<SessionRoute>());
    expect((captured as SessionRoute).id, 'sess-1');
  });

  test('payload with channelId routes to ChannelRoute', () {
    handler.navigateForPayload({'channelId': 'chan-1'});
    final captured =
        verify(() => router.navigateTo(captureAny())).captured.single
            as AppRoute;
    expect(captured, isA<ChannelRoute>());
    expect((captured as ChannelRoute).id, 'chan-1');
  });

  test('payload with both prefers sessionId', () {
    handler.navigateForPayload({'sessionId': 's', 'channelId': 'c'});
    final captured =
        verify(() => router.navigateTo(captureAny())).captured.single
            as AppRoute;
    expect(captured, isA<SessionRoute>());
  });

  test('payload with neither routes to NotificationsRoute', () {
    handler.navigateForPayload({'kind': 'agent_idle'});
    final captured =
        verify(() => router.navigateTo(captureAny())).captured.single
            as AppRoute;
    expect(captured, isA<NotificationsRoute>());
  });

  test('empty sessionId is treated as absent', () {
    handler.navigateForPayload({'sessionId': '', 'channelId': 'c'});
    final captured =
        verify(() => router.navigateTo(captureAny())).captured.single
            as AppRoute;
    expect(captured, isA<ChannelRoute>());
  });

  test('payload with notificationId calls onMarkRead with that id', () async {
    final calls = <String>[];
    final h = NotificationTapHandler(
      router: router,
      onMarkRead: (id) async {
        calls.add(id);
      },
    );
    h.navigateForPayload({
      'notificationId': 'notif-42',
      'sessionId': 'sess-1',
    });
    // onMarkRead is fire-and-forget — let the microtask drain.
    await Future<void>.delayed(Duration.zero);
    expect(calls, ['notif-42']);
    verify(() => router.navigateTo(any())).called(1);
  });

  test('payload without notificationId does not call onMarkRead', () async {
    var called = false;
    final h = NotificationTapHandler(
      router: router,
      onMarkRead: (id) async {
        called = true;
      },
    );
    h.navigateForPayload({'sessionId': 'sess-1'});
    await Future<void>.delayed(Duration.zero);
    expect(called, isFalse);
    verify(() => router.navigateTo(any())).called(1);
  });

  test('empty notificationId does not call onMarkRead', () async {
    var called = false;
    final h = NotificationTapHandler(
      router: router,
      onMarkRead: (id) async {
        called = true;
      },
    );
    h.navigateForPayload({'notificationId': '', 'sessionId': 'sess-1'});
    await Future<void>.delayed(Duration.zero);
    expect(called, isFalse);
  });

  test('onMarkRead failure does not throw and does not block navigation',
      () async {
    final h = NotificationTapHandler(
      router: router,
      onMarkRead: (id) async {
        throw StateError('boom');
      },
    );
    // Must not throw.
    h.navigateForPayload({
      'notificationId': 'notif-1',
      'sessionId': 'sess-1',
    });
    await Future<void>.delayed(Duration.zero);
    final captured =
        verify(() => router.navigateTo(captureAny())).captured.single
            as AppRoute;
    expect(captured, isA<SessionRoute>());
  });
}
