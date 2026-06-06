import 'package:connectivity_plus/connectivity_plus.dart';

import '../../application/ports/connectivity_port.dart';

/// [ConnectivityPort] backed by the `connectivity_plus` plugin. Maps the
/// plugin's transport list (`wifi`, `mobile`, `none`, …) to a single
/// online/offline bool: online iff at least one transport is not `none`.
class ConnectivityPlusAdapter implements ConnectivityPort {
  ConnectivityPlusAdapter([Connectivity? connectivity])
      : _connectivity = connectivity ?? Connectivity();

  final Connectivity _connectivity;

  static bool _anyOnline(List<ConnectivityResult> results) =>
      results.any((r) => r != ConnectivityResult.none);

  @override
  Future<bool> isOnline() async =>
      _anyOnline(await _connectivity.checkConnectivity());

  @override
  Stream<bool> get onConnectivityChanged =>
      // `.distinct()` so the coarse online/offline bool only emits on a
      // genuine transition. The raw `connectivity_plus` stream relays every
      // platform connectivity callback — on cellular, Android's
      // `onCapabilitiesChanged` fires a flood of events that all map to the
      // SAME `online == true`. Without de-duping, each redundant `true`
      // reaches PushTokenRegistrar's connectivity listener, which kept
      // `_retryQueued` set so `_afterPass` did immediate re-runs and the
      // 15s→5min backoff never engaged → a ~2-3s retry storm when a request
      // persistently failed (e.g. an off-LAN CF `302`). One bool per real
      // transition lets the existing backoff own the retry cadence.
      _connectivity.onConnectivityChanged.map(_anyOnline).distinct();
}
