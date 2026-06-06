import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/infrastructure/network/connectivity_plus_adapter.dart';

class _MockConnectivity extends Mock implements Connectivity {}

void main() {
  group('ConnectivityPlusAdapter.onConnectivityChanged', () {
    test(
      'de-dupes a flood of distinct online transport lists to one bool per '
      'genuine transition',
      () async {
        // The raw connectivity_plus stream only de-dupes identical transport
        // LISTS. On cellular, Android emits a flood of DISTINCT lists (signal
        // / capability changes) that all map to the SAME online == true — e.g.
        // [wifi] → [wifi, mobile] → [mobile]. Without a bool-level .distinct()
        // each redundant `true` reaches the push registrar and defeats its
        // backoff. The adapter must collapse them.
        final raw = StreamController<List<ConnectivityResult>>();
        final conn = _MockConnectivity();
        when(() => conn.onConnectivityChanged).thenAnswer((_) => raw.stream);

        final adapter = ConnectivityPlusAdapter(conn);
        final emitted = <bool>[];
        final sub = adapter.onConnectivityChanged.listen(emitted.add);

        // offline → (flood of distinct online lists) → offline → online.
        raw
          ..add(const [ConnectivityResult.none])
          ..add(const [ConnectivityResult.wifi])
          ..add(const [ConnectivityResult.wifi, ConnectivityResult.mobile])
          ..add(const [ConnectivityResult.mobile])
          ..add(const [ConnectivityResult.none])
          ..add(const [ConnectivityResult.wifi]);
        await pumpEventQueue();

        // Exactly one bool per genuine transition: false, true, false, true.
        expect(emitted, [false, true, false, true]);

        await sub.cancel();
        await raw.close();
      },
    );

    test('maps any non-none transport to online', () async {
      final raw = StreamController<List<ConnectivityResult>>();
      final conn = _MockConnectivity();
      when(() => conn.onConnectivityChanged).thenAnswer((_) => raw.stream);

      final adapter = ConnectivityPlusAdapter(conn);
      final emitted = <bool>[];
      final sub = adapter.onConnectivityChanged.listen(emitted.add);

      raw
        ..add(const [ConnectivityResult.none])
        ..add(const [ConnectivityResult.vpn]) // non-none → online
        ..add(const [ConnectivityResult.none]);
      await pumpEventQueue();

      expect(emitted, [false, true, false]);

      await sub.cancel();
      await raw.close();
    });
  });

  group('ConnectivityPlusAdapter.isOnline', () {
    test('true when any transport is non-none, false when all none', () async {
      final conn = _MockConnectivity();
      final adapter = ConnectivityPlusAdapter(conn);

      when(conn.checkConnectivity)
          .thenAnswer((_) async => const [ConnectivityResult.mobile]);
      expect(await adapter.isOnline(), isTrue);

      when(conn.checkConnectivity)
          .thenAnswer((_) async => const [ConnectivityResult.none]);
      expect(await adapter.isOnline(), isFalse);
    });
  });
}
