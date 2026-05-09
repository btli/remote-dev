import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'infrastructure/push/fcm_push_service.dart';

void main() {
  // Non-blocking push init — runs in the background; failures are logged
  // and don't prevent the UI from launching.
  Future<void>.microtask(() => FcmPushService().initialize());

  runApp(const ProviderScope(child: RemoteDevApp()));
}
