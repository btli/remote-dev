import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/domain/active_node.dart';
import 'package:remote_dev/domain/channel.dart';
import 'package:remote_dev/infrastructure/api/channels_api.dart';
import 'package:remote_dev/infrastructure/api/preferences_api.dart';
import 'package:remote_dev/presentation/screens/channels/channels_tab_screen.dart';

class _FakeChannelsApi extends Fake implements ChannelsApi {
  _FakeChannelsApi(this._channels);
  final List<Channel> _channels;
  bool _shouldThrow = false;
  int listCallCount = 0;
  final List<ActiveNode?> calledWith = [];

  void setError() {
    _shouldThrow = true;
  }

  @override
  Future<List<Channel>> list({ActiveNode? activeNode}) async {
    listCallCount += 1;
    calledWith.add(activeNode);
    if (_shouldThrow) {
      throw StateError('boom');
    }
    return _channels;
  }

  @override
  Future<void> archive(String id) async {}
}

/// Configurable preferences fake. `node` is the initial active node; the
/// notifier's `select` round-trips through `setActiveNode` then re-reads
/// via `getActiveNode`, so we mutate `_current` in `setActiveNode` and
/// return it on subsequent reads.
class _FakePreferencesApi extends Fake implements PreferencesApi {
  _FakePreferencesApi({ActiveNode? initial}) : _current = initial;
  ActiveNode? _current;
  int getCallCount = 0;
  int setCallCount = 0;

  @override
  Future<ActiveNode?> getActiveNode() async {
    getCallCount += 1;
    return _current;
  }

  @override
  Future<void> setActiveNode({
    required String? nodeId,
    required ActiveNodeType? nodeType,
    bool pinned = false,
  }) async {
    setCallCount += 1;
    if (nodeId == null || nodeType == null) {
      _current = null;
    } else {
      _current = ActiveNode(id: nodeId, type: nodeType);
    }
  }
}

void main() {
  Widget wrap({
    required _FakeChannelsApi channelsApi,
    required _FakePreferencesApi preferencesApi,
  }) =>
      ProviderScope(
        overrides: [
          channelsApiProvider.overrideWithValue(channelsApi),
          preferencesApiProvider.overrideWithValue(preferencesApi),
        ],
        child: const MaterialApp(home: ChannelsTabScreen()),
      );

  testWidgets(
    'shows "No project selected" empty state when no active node',
    (tester) async {
      final channelsApi = _FakeChannelsApi(const []);
      final preferencesApi = _FakePreferencesApi();
      await tester.pumpWidget(
        wrap(channelsApi: channelsApi, preferencesApi: preferencesApi),
      );
      await tester.pumpAndSettle();

      expect(find.text('No project selected'), findsOneWidget);
      expect(find.text('Pick a project to load channels.'), findsOneWidget);
      // Crucially: the channels API must NOT be hit when there's no node,
      // because the server would 400 without a scope.
      expect(channelsApi.listCallCount, 0);
    },
  );

  testWidgets(
    'fetches channels scoped to the active node when one is set',
    (tester) async {
      final channelsApi = _FakeChannelsApi(const [
        Channel(id: 'c1', name: 'general'),
      ]);
      final preferencesApi = _FakePreferencesApi(
        initial: const ActiveNode(
          id: 'proj-42',
          type: ActiveNodeType.project,
          name: 'Demo project',
        ),
      );
      await tester.pumpWidget(
        wrap(channelsApi: channelsApi, preferencesApi: preferencesApi),
      );
      await tester.pumpAndSettle();

      // Channels rendered for the active project.
      expect(find.text('general'), findsOneWidget);
      // The fetch is scoped to the active node — this is the bug that
      // motivated the work; verify the param actually reaches the API.
      expect(channelsApi.listCallCount, greaterThanOrEqualTo(1));
      expect(channelsApi.calledWith.first?.id, 'proj-42');
      expect(channelsApi.calledWith.first?.type, ActiveNodeType.project);
      // Project name surfaces in the app bar subtitle.
      expect(find.text('Demo project'), findsOneWidget);
    },
  );

  testWidgets(
    'renders unread badges and caps at 99+',
    (tester) async {
      final channelsApi = _FakeChannelsApi(const [
        Channel(id: 'c1', name: 'busy', unreadCount: 7),
        Channel(id: 'c2', name: 'huge', unreadCount: 142),
        Channel(id: 'c3', name: 'silent', unreadCount: 0),
      ]);
      final preferencesApi = _FakePreferencesApi(
        initial: const ActiveNode(id: 'p', type: ActiveNodeType.project),
      );
      await tester.pumpWidget(
        wrap(channelsApi: channelsApi, preferencesApi: preferencesApi),
      );
      await tester.pumpAndSettle();

      expect(find.text('7'), findsOneWidget);
      expect(find.text('99+'), findsOneWidget);
      expect(find.text('0'), findsNothing);
    },
  );

  testWidgets(
    'shows error view when channel fetch fails',
    (tester) async {
      final channelsApi = _FakeChannelsApi(const [])..setError();
      final preferencesApi = _FakePreferencesApi(
        initial: const ActiveNode(id: 'p', type: ActiveNodeType.project),
      );
      await tester.pumpWidget(
        wrap(channelsApi: channelsApi, preferencesApi: preferencesApi),
      );
      await tester.pumpAndSettle();

      expect(find.text('Failed to load channels'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    },
  );

  testWidgets(
    'polls channels list every 30s while mounted with an active node',
    (tester) async {
      final channelsApi = _FakeChannelsApi(const [
        Channel(id: 'c1', name: 'general'),
      ]);
      final preferencesApi = _FakePreferencesApi(
        initial: const ActiveNode(id: 'p', type: ActiveNodeType.project),
      );
      await tester.pumpWidget(
        wrap(channelsApi: channelsApi, preferencesApi: preferencesApi),
      );
      await tester.pumpAndSettle();
      final initial = channelsApi.listCallCount;
      expect(initial, greaterThanOrEqualTo(1));

      await tester.pump(const Duration(seconds: 30));
      await tester.pumpAndSettle();
      expect(channelsApi.listCallCount, greaterThan(initial));
    },
  );

  testWidgets(
    'cancels timer on dispose so no further polls fire',
    (tester) async {
      final channelsApi = _FakeChannelsApi(const [
        Channel(id: 'c1', name: 'general'),
      ]);
      final preferencesApi = _FakePreferencesApi(
        initial: const ActiveNode(id: 'p', type: ActiveNodeType.project),
      );
      // Mount + unmount within the same ProviderScope shape (Riverpod
      // requires identical override counts across pumpWidget calls).
      await tester.pumpWidget(
        wrap(channelsApi: channelsApi, preferencesApi: preferencesApi),
      );
      await tester.pumpAndSettle();
      final afterMount = channelsApi.listCallCount;

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            channelsApiProvider.overrideWithValue(channelsApi),
            preferencesApiProvider.overrideWithValue(preferencesApi),
          ],
          child: const MaterialApp(home: SizedBox.shrink()),
        ),
      );
      await tester.pumpAndSettle();

      final afterDispose = channelsApi.listCallCount;
      await tester.pump(const Duration(seconds: 60));
      await tester.pumpAndSettle();
      expect(
        channelsApi.listCallCount,
        afterDispose,
        reason: 'Polling must stop once the tab is disposed',
      );
      // Sanity: we did poll at least the initial fetch before dispose.
      expect(afterMount, greaterThanOrEqualTo(1));
    },
  );

  testWidgets(
    'stops polling when app is backgrounded, resumes on return',
    (tester) async {
      final channelsApi = _FakeChannelsApi(const [
        Channel(id: 'c1', name: 'general'),
      ]);
      final preferencesApi = _FakePreferencesApi(
        initial: const ActiveNode(id: 'p', type: ActiveNodeType.project),
      );
      await tester.pumpWidget(
        wrap(channelsApi: channelsApi, preferencesApi: preferencesApi),
      );
      await tester.pumpAndSettle();
      final afterMount = channelsApi.listCallCount;

      tester.binding
          .handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pumpAndSettle();
      final afterPause = channelsApi.listCallCount;
      await tester.pump(const Duration(seconds: 60));
      await tester.pumpAndSettle();
      expect(
        channelsApi.listCallCount,
        afterPause,
        reason: 'No polling should happen while backgrounded',
      );
      expect(afterMount, greaterThanOrEqualTo(1));

      tester.binding
          .handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(channelsApi.listCallCount, greaterThan(afterPause));
    },
  );

  testWidgets(
    'select() persists the new node and refetches channels',
    (tester) async {
      // Start with no active node; programmatically select one via the
      // notifier and assert the API call shape + ensuing channel fetch.
      final channelsApi = _FakeChannelsApi(const [
        Channel(id: 'c1', name: 'general'),
      ]);
      final preferencesApi = _FakePreferencesApi();
      await tester.pumpWidget(
        wrap(channelsApi: channelsApi, preferencesApi: preferencesApi),
      );
      await tester.pumpAndSettle();

      expect(find.text('No project selected'), findsOneWidget);
      expect(channelsApi.listCallCount, 0);

      // Drive the notifier directly — this is the same code path the
      // "Pick a project" button takes after the bottom sheet returns.
      final container = ProviderScope.containerOf(
        tester.element(find.byType(ChannelsTabScreen)),
      );
      await container.read(activeNodeProvider.notifier).select(
            nodeId: 'proj-new',
            nodeType: ActiveNodeType.project,
          );
      await tester.pumpAndSettle();

      expect(preferencesApi.setCallCount, 1);
      // After selection, the channels list provider rebuilds against the
      // new node and renders the row.
      expect(find.text('general'), findsOneWidget);
      expect(channelsApi.calledWith.last?.id, 'proj-new');
      expect(channelsApi.calledWith.last?.type, ActiveNodeType.project);
    },
  );
}
