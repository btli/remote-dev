import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/infrastructure/deep_link/deep_link_router.dart';
import 'package:remote_dev/presentation/router/app_route.dart';

void main() {
  group('DeepLinkRouter.routeFor', () {
    test('remotedev://session/<id>', () {
      final r = DeepLinkRouter.routeFor(Uri.parse('remotedev://session/abc'));
      expect(r, isA<SessionRoute>());
      expect((r! as SessionRoute).id, 'abc');
    });

    test('remotedev://channel/<id>', () {
      final r = DeepLinkRouter.routeFor(Uri.parse('remotedev://channel/xyz'));
      expect(r, isA<ChannelRoute>());
      expect((r! as ChannelRoute).id, 'xyz');
    });

    test('remotedev://recording/<id>', () {
      final r =
          DeepLinkRouter.routeFor(Uri.parse('remotedev://recording/123'));
      expect(r, isA<RecordingRoute>());
      expect((r! as RecordingRoute).id, '123');
    });

    test('remotedev://notifications', () {
      final r =
          DeepLinkRouter.routeFor(Uri.parse('remotedev://notifications'));
      expect(r, isA<NotificationsRoute>());
    });

    test('remotedev://home', () {
      final r = DeepLinkRouter.routeFor(Uri.parse('remotedev://home'));
      expect(r, isA<HomeRoute>());
    });

    test('https://server/m/session/<id>', () {
      final r = DeepLinkRouter.routeFor(
        Uri.parse('https://dev.example.com/m/session/abc'),
      );
      expect(r, isA<SessionRoute>());
      expect((r! as SessionRoute).id, 'abc');
    });

    test('https://server/m/channel/<id>', () {
      final r = DeepLinkRouter.routeFor(
        Uri.parse('https://dev.example.com/m/channel/xyz'),
      );
      expect(r, isA<ChannelRoute>());
      expect((r! as ChannelRoute).id, 'xyz');
    });

    test('https://server/m/recording/<id>', () {
      final r = DeepLinkRouter.routeFor(
        Uri.parse('https://dev.example.com/m/recording/777'),
      );
      expect(r, isA<RecordingRoute>());
      expect((r! as RecordingRoute).id, '777');
    });

    test('https://server/m/notifications', () {
      final r = DeepLinkRouter.routeFor(
        Uri.parse('https://dev.example.com/m/notifications'),
      );
      expect(r, isA<NotificationsRoute>());
    });

    test('returns null for unknown surface', () {
      final r =
          DeepLinkRouter.routeFor(Uri.parse('remotedev://unknown/whatever'));
      expect(r, isNull);
    });

    test('returns null for empty path on custom scheme', () {
      final r = DeepLinkRouter.routeFor(Uri.parse('remotedev://'));
      expect(r, isNull);
    });

    test('returns null for missing id on session', () {
      final r = DeepLinkRouter.routeFor(Uri.parse('remotedev://session'));
      expect(r, isNull);
    });

    test('returns null for missing id on channel', () {
      final r = DeepLinkRouter.routeFor(Uri.parse('remotedev://channel'));
      expect(r, isNull);
    });

    test('returns null for missing id on recording', () {
      final r = DeepLinkRouter.routeFor(Uri.parse('remotedev://recording'));
      expect(r, isNull);
    });

    test('returns null for https root with no /m/ segment', () {
      final r = DeepLinkRouter.routeFor(
        Uri.parse('https://dev.example.com/'),
      );
      expect(r, isNull);
    });
  });
}
