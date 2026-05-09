import 'package:flutter/material.dart';

class VersionMismatchScreen extends StatelessWidget {
  const VersionMismatchScreen({
    required this.expectedVersion,
    required this.actualVersion,
    required this.onOpenStore,
    super.key,
  });

  final int expectedVersion;
  final int actualVersion;
  final VoidCallback onOpenStore;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.system_update,
                  size: 64,
                  color: Color(0xFF7AA2F7),
                ),
                const SizedBox(height: 24),
                const Text(
                  'Update Remote Dev',
                  style: TextStyle(color: Colors.white, fontSize: 22),
                ),
                const SizedBox(height: 12),
                Text(
                  'This version of the app is older than the server expects '
                  '(v$actualVersion vs v$expectedVersion). Update to continue.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white70),
                ),
                const SizedBox(height: 32),
                ElevatedButton(
                  onPressed: onOpenStore,
                  child: const Text('Open store'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
