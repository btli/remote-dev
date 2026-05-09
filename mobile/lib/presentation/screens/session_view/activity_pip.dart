import 'package:flutter/material.dart';

enum SessionActivity {
  running,
  waiting,
  idle,
  error,
  disconnected,
  reconnecting,
  none,
}

class ActivityPip extends StatelessWidget {
  const ActivityPip({required this.activity, this.size = 8, super.key});

  final SessionActivity activity;
  final double size;

  Color _color() {
    switch (activity) {
      case SessionActivity.running:
        return const Color(0xFF9ECE6A); // green
      case SessionActivity.waiting:
        return const Color(0xFFE0AF68); // yellow
      case SessionActivity.idle:
        return const Color(0xFF565F89); // grey
      case SessionActivity.error:
        return const Color(0xFFF7768E); // red
      case SessionActivity.disconnected:
        return const Color(0xFF414868); // dim grey
      case SessionActivity.reconnecting:
        return const Color(0xFF7AA2F7); // blue
      case SessionActivity.none:
        return Colors.transparent;
    }
  }

  String _label() {
    switch (activity) {
      case SessionActivity.running:
        return 'Running';
      case SessionActivity.waiting:
        return 'Waiting';
      case SessionActivity.idle:
        return 'Idle';
      case SessionActivity.error:
        return 'Error';
      case SessionActivity.disconnected:
        return 'Disconnected';
      case SessionActivity.reconnecting:
        return 'Reconnecting';
      case SessionActivity.none:
        return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    if (activity == SessionActivity.none) {
      return SizedBox(width: size, height: size);
    }
    return Tooltip(
      message: _label(),
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: _color(),
          shape: BoxShape.circle,
        ),
      ),
    );
  }
}
