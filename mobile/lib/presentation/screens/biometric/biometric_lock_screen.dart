import 'package:flutter/material.dart';

/// Full-screen overlay shown while the app is locked.
///
/// Pure view — auth state and the `authenticate()` call live in
/// [BiometricLockOverlay]. We keep this widget stateless so a parent overlay
/// can re-render it without resetting any internal state.
class BiometricLockScreen extends StatelessWidget {
  const BiometricLockScreen({required this.onAuthenticate, super.key});

  final VoidCallback onAuthenticate;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF1A1B26),
      child: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.lock_outline,
                  size: 64,
                  color: Color(0xFF7AA2F7),
                ),
                const SizedBox(height: 24),
                const Text(
                  'Remote Dev locked',
                  style: TextStyle(color: Colors.white, fontSize: 22),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Authenticate to continue.',
                  style: TextStyle(color: Colors.white60, fontSize: 14),
                ),
                const SizedBox(height: 32),
                ElevatedButton.icon(
                  onPressed: onAuthenticate,
                  icon: const Icon(Icons.fingerprint),
                  label: const Text('Authenticate'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
