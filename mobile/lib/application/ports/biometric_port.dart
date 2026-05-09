/// Authenticates the user via the OS biometric / device-credential prompt.
///
/// Implementations wrap platform plugins (e.g. `local_auth`) so that callers
/// can stay framework-agnostic and tests can swap in fakes via DI.
abstract class BiometricPort {
  /// Returns true on successful authentication. Returns false on cancel
  /// or if biometrics aren't available.
  Future<bool> authenticate({String reason = 'Unlock Remote Dev'});

  /// Whether the device has any biometric or device-credential method
  /// available. False on simulators / desktops without credentials enrolled.
  Future<bool> isAvailable();
}
