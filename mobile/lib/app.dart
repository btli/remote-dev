import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class RemoteDevApp extends ConsumerWidget {
  const RemoteDevApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: 'Remote Dev',
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF7AA2F7),
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF1A1B26),
      ),
      home: const _PlaceholderScreen(),
    );
  }
}

class _PlaceholderScreen extends StatelessWidget {
  const _PlaceholderScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Text(
          'Remote Dev — Phase 1 scaffold',
          style: TextStyle(color: Colors.white),
        ),
      ),
    );
  }
}
