import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'presentation/router/app_router.dart';

final appRouterProvider = Provider<AppRouter>((ref) => AppRouter());

class RemoteDevApp extends ConsumerWidget {
  const RemoteDevApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    return MaterialApp.router(
      title: 'Remote Dev',
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF7AA2F7),
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF1A1B26),
      ),
      routerConfig: router.config,
    );
  }
}
