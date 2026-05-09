import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Wraps the Android-side MethodChannel for clearing OS-tray
/// notifications. No-op on iOS (the OS clears the tray automatically
/// when the app foregrounds).
class AndroidDismissalChannel {
  AndroidDismissalChannel({MethodChannel? channel})
      : _channel = channel ??
            const MethodChannel('com.remotedev.remote_dev/notifications');

  final MethodChannel _channel;

  /// Clears all OS-tray notifications. No-op on iOS or when the native
  /// side isn't wired (test environment).
  Future<void> cancelAll() async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod<void>('cancelAll');
    } on PlatformException catch (e) {
      debugPrint('[Push] cancelAll PlatformException: $e');
    } on MissingPluginException {
      // Native side not yet wired (test environment).
    }
  }
}
