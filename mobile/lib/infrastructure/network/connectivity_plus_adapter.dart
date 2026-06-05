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
      _connectivity.onConnectivityChanged.map(_anyOnline);
}
