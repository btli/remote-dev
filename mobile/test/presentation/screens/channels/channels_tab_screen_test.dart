import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/domain/channel.dart';
import 'package:remote_dev/infrastructure/api/channels_api.dart';
import 'package:remote_dev/presentation/screens/channels/channels_tab_screen.dart';

class _FakeChannelsApi extends Fake implements ChannelsApi {
  _FakeChannelsApi(this._channels);
  final List<Channel> _channels;
  bool _shouldThrow = false;
  int listCallCount = 0;

  void setError() {
    _shouldThrow = true;
  }

  @override
  Future<List<Channel>> list() async {
    listCallCount += 1;
    if (_shouldThrow) {
      throw StateError('boom');
    }
    return _channels;
  }

  @override
  Future<void> archive(String id) async {}
}

void main() {
  Widget wrap(Widget child, {required _FakeChannelsApi api}) => ProviderScope(
        overrides: [
          channelsApiProvider.overrideWithValue(api),
        ],
        child: MaterialApp(home: child),
      );

  testWidgets('shows empty state when no channels', (tester) async {
    final api = _FakeChannelsApi(const []);
    await tester.pumpWidget(wrap(const ChannelsTabScreen(), api: api));
    await tester.pumpAndSettle();

    expect(find.text('No channels yet'), findsOneWidget);
    expect(find.byIcon(Icons.forum_outlined), findsOneWidget);
  });

  testWidgets('renders rows for each channel', (tester) async {
    final api = _FakeChannelsApi(const [
      Channel(id: 'c1', name: 'general', unreadCount: 0),
      Channel(id: 'c2', name: 'random', unreadCount: 0),
      Channel(id: 'c3', name: 'announcements', unreadCount: 0),
    ]);

    await tester.pumpWidget(wrap(const ChannelsTabScreen(), api: api));
    await tester.pumpAndSettle();

    expect(find.text('general'), findsOneWidget);
    expect(find.text('random'), findsOneWidget);
    expect(find.text('announcements'), findsOneWidget);
  });

  testWidgets('renders unread badge for channels with unread > 0',
      (tester) async {
    final api = _FakeChannelsApi(const [
      Channel(id: 'c1', name: 'general', unreadCount: 0),
      Channel(id: 'c2', name: 'busy', unreadCount: 7),
      Channel(id: 'c3', name: 'super-busy', unreadCount: 142),
    ]);

    await tester.pumpWidget(wrap(const ChannelsTabScreen(), api: api));
    await tester.pumpAndSettle();

    // Unread channels render a count.
    expect(find.text('7'), findsOneWidget);
    // Capped at 99+.
    expect(find.text('99+'), findsOneWidget);
    // The zero-unread channel must not render '0' badge text.
    expect(find.text('0'), findsNothing);
  });

  testWidgets('shows error view when list fails', (tester) async {
    final api = _FakeChannelsApi(const [])..setError();
    await tester.pumpWidget(wrap(const ChannelsTabScreen(), api: api));
    await tester.pumpAndSettle();

    expect(find.text('Failed to load channels'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('polls channels list every 30s while mounted',
      (tester) async {
    final api = _FakeChannelsApi(const [
      Channel(id: 'c1', name: 'general', unreadCount: 0),
    ]);
    await tester.pumpWidget(wrap(const ChannelsTabScreen(), api: api));
    await tester.pumpAndSettle();

    // Initial load fired exactly once.
    expect(api.listCallCount, 1);

    // Advance the fake clock past the 30s polling interval and let the
    // resulting future settle.
    await tester.pump(const Duration(seconds: 30));
    await tester.pumpAndSettle();
    expect(api.listCallCount, greaterThan(1));

    // A second tick should fire another refresh.
    final afterFirstTick = api.listCallCount;
    await tester.pump(const Duration(seconds: 30));
    await tester.pumpAndSettle();
    expect(api.listCallCount, greaterThan(afterFirstTick));
  });

  testWidgets('cancels timer on dispose so no further polls fire',
      (tester) async {
    final api = _FakeChannelsApi(const [
      Channel(id: 'c1', name: 'general', unreadCount: 0),
    ]);
    // Mount inside the same ProviderScope (single override), then swap the
    // child to a benign widget. This unmounts ChannelsTabScreen and triggers
    // dispose() while keeping the override list shape stable (Riverpod
    // requires identical override counts across pumpWidget calls).
    await tester.pumpWidget(wrap(const ChannelsTabScreen(), api: api));
    await tester.pumpAndSettle();
    expect(api.listCallCount, 1);

    await tester.pumpWidget(
      wrap(const SizedBox.shrink(), api: api),
    );
    await tester.pumpAndSettle();

    final afterDispose = api.listCallCount;
    await tester.pump(const Duration(seconds: 60));
    await tester.pumpAndSettle();
    // No additional polls should have fired after dispose.
    expect(api.listCallCount, afterDispose);
  });

  testWidgets('stops polling when app is backgrounded and resumes on return',
      (tester) async {
    final api = _FakeChannelsApi(const [
      Channel(id: 'c1', name: 'general', unreadCount: 0),
    ]);
    await tester.pumpWidget(wrap(const ChannelsTabScreen(), api: api));
    await tester.pumpAndSettle();
    expect(api.listCallCount, 1);

    // Background the app — polling should stop.
    final binding = tester.binding;
    binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pumpAndSettle();

    final afterPause = api.listCallCount;
    await tester.pump(const Duration(seconds: 60));
    await tester.pumpAndSettle();
    expect(
      api.listCallCount,
      afterPause,
      reason: 'No polling should happen while backgrounded',
    );

    // Resume the app — should refresh immediately and restart the timer.
    binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(api.listCallCount, greaterThan(afterPause));
  });
}
