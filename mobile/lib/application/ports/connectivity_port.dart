/// Observe device network connectivity. Implementations normalize the
/// platform's transport list to a simple online/offline bool. Used by the
/// push-token registrar to retry registrations that failed while offline.
abstract class ConnectivityPort {
  /// True when the device currently has at least one usable network transport.
  Future<bool> isOnline();

  /// Emits `true` whenever connectivity is (re)gained and `false` when it is
  /// lost. A spurious extra `true` is harmless — the registrar no-ops when no
  /// registration is pending.
  Stream<bool> get onConnectivityChanged;
}
