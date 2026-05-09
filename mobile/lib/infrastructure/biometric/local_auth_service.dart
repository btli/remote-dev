import 'package:flutter/foundation.dart';
import 'package:local_auth/local_auth.dart';

import '../../application/ports/biometric_port.dart';

/// `local_auth`-backed [BiometricPort] implementation.
///
/// Allows device passcode fallback (`biometricOnly: false`) so users without
/// enrolled biometrics can still unlock with their PIN. `stickyAuth: true`
/// keeps the prompt alive across app backgrounding (e.g. when iOS pushes the
/// Face ID confirmation sheet).
class LocalAuthService implements BiometricPort {
  LocalAuthService([LocalAuthentication? auth])
      : _auth = auth ?? LocalAuthentication();

  final LocalAuthentication _auth;

  @override
  Future<bool> isAvailable() async {
    try {
      final supported = await _auth.isDeviceSupported();
      if (!supported) return false;
      final canCheck = await _auth.canCheckBiometrics;
      return canCheck;
    } catch (e) {
      debugPrint('[Biometric] availability check failed: $e');
      return false;
    }
  }

  @override
  Future<bool> authenticate({String reason = 'Unlock Remote Dev'}) async {
    try {
      return await _auth.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(
          biometricOnly: false, // allow device passcode fallback
          stickyAuth: true,
        ),
      );
    } catch (e) {
      debugPrint('[Biometric] authenticate failed: $e');
      return false;
    }
  }
}
