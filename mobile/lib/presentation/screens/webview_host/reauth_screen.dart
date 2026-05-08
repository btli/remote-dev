import 'package:flutter/material.dart';

class ReauthScreen extends StatelessWidget {
  const ReauthScreen({required this.onReauthenticate, super.key});

  final VoidCallback onReauthenticate;

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
                const Icon(Icons.lock_outline, size: 64, color: Color(0xFF7AA2F7)),
                const SizedBox(height: 24),
                const Text(
                  'Authentication needed',
                  style: TextStyle(color: Colors.white, fontSize: 22),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Your session expired. Sign in again to continue.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white70),
                ),
                const SizedBox(height: 32),
                ElevatedButton(
                  onPressed: onReauthenticate,
                  child: const Text('Re-authenticate'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
