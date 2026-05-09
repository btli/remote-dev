import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'infrastructure/push/fcm_push_service.dart';

void main() {
  // Non-blocking push init — runs in the background; failures are logged
  // and don't prevent the UI from launching.
  Future<void>.microtask(() => FcmPushService().initialize());

  // Build a ProviderContainer up-front so we can eagerly start the deep-link
  // listener before runApp. This ensures custom-scheme links delivered during
  // cold-start are routed correctly.
  final container = ProviderContainer();
  // Read for side effect — kicks off AppLinkListener.start().
  container.read(appLinkListenerProvider);

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const RemoteDevApp(),
    ),
  );
}
