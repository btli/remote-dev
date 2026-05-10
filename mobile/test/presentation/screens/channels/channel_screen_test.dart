import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/domain/channel.dart';
import 'package:remote_dev/infrastructure/api/channels_api.dart';
import 'package:remote_dev/presentation/screens/channels/channel_screen.dart';
import 'package:remote_dev/presentation/screens/channels/channels_tab_screen.dart';

/// `ChannelScreen` is a thin native wrapper around an embedded WebView
/// pointed at `<server>/m/channel/<id>` — the real message list, send
/// box, and thread panel are rendered by the React PWA inside the
/// WebView. The native side only owns the AppBar (back button + title)
/// and the WebView frame.
///
/// We deliberately do NOT call `pumpAndSettle` — InAppWebView's platform
/// channel cannot be exercised in widget tests.
class _FakeChannelsApi extends Fake implements ChannelsApi {
  _FakeChannelsApi(this._channels);
  final List<Channel> _channels;

  @override
  Future<List<Channel>> list() async => _channels;

  @override
  Future<void> archive(String id) async {}
}

void main() {
  testWidgets('ChannelScreen mounts with the channel AppBar', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: ChannelScreen(channelId: 'test-channel'),
        ),
      ),
    );
    await tester.pump();
    // Generic title until/unless the channels list resolves with a match.
    expect(find.text('Channel'), findsAtLeast(1));
    expect(find.byIcon(Icons.arrow_back), findsOneWidget);
  });

  testWidgets(
    'AppBar title resolves to "#<name>" once channelsListProvider has the channel',
    (tester) async {
      final api = _FakeChannelsApi(const [
        Channel(id: 'c1', name: 'general'),
        Channel(id: 'c2', name: 'random'),
      ]);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            channelsApiProvider.overrideWithValue(api),
          ],
          child: const MaterialApp(
            home: ChannelScreen(channelId: 'c2'),
          ),
        ),
      );

      // Drain microtasks so the FutureProvider for channels resolves.
      // We avoid pumpAndSettle because InAppWebView never settles.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();

      expect(find.text('#random'), findsOneWidget);
      expect(find.byIcon(Icons.arrow_back), findsOneWidget);
    },
  );

  testWidgets(
    'AppBar falls back to generic title when channelId is unknown',
    (tester) async {
      final api = _FakeChannelsApi(const [
        Channel(id: 'c1', name: 'general'),
      ]);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            channelsApiProvider.overrideWithValue(api),
          ],
          child: const MaterialApp(
            home: ChannelScreen(channelId: 'missing-id'),
          ),
        ),
      );

      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();

      // The id isn't in the list → keep the generic "Channel" title,
      // which is what arrives via deep-link before the cache is populated.
      expect(find.text('Channel'), findsAtLeast(1));
      expect(find.text('#general'), findsNothing);
    },
  );
}
