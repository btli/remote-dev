import 'package:flutter/material.dart';

class ServerUnreachableScreen extends StatelessWidget {
  const ServerUnreachableScreen({
    required this.serverLabel,
    required this.onRetry,
    required this.onSwitchServer,
    super.key,
  });

  final String serverLabel;
  final VoidCallback onRetry;
  final VoidCallback onSwitchServer;

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
                const Icon(Icons.cloud_off, size: 64, color: Color(0xFFF7768E)),
                const SizedBox(height: 24),
                const Text(
                  "Can't reach server",
                  style: TextStyle(color: Colors.white, fontSize: 22),
                ),
                const SizedBox(height: 8),
                Text(
                  serverLabel,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white70),
                ),
                const SizedBox(height: 32),
                ElevatedButton.icon(
                  icon: const Icon(Icons.refresh),
                  label: const Text('Retry'),
                  onPressed: onRetry,
                ),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: onSwitchServer,
                  child: const Text('Switch server'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
