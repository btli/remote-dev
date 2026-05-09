import 'package:flutter/material.dart';

class ReconnectingBanner extends StatelessWidget {
  const ReconnectingBanner({
    this.onRetry,
    super.key,
  });

  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFE0AF68),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Row(
          children: [
            const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                valueColor: AlwaysStoppedAnimation(Color(0xFF1A1B26)),
              ),
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Text(
                'Reconnecting…',
                style: TextStyle(color: Color(0xFF1A1B26), fontSize: 13),
              ),
            ),
            if (onRetry != null)
              TextButton(
                onPressed: onRetry,
                style: TextButton.styleFrom(
                  foregroundColor: const Color(0xFF1A1B26),
                ),
                child: const Text('Retry'),
              ),
          ],
        ),
      ),
    );
  }
}
