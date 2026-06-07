import 'package:flutter/material.dart';

import '../../../domain/session_summary.dart';

enum SessionActivity {
  running,
  waiting,
  idle,
  error,
  subagent,
  compacting,
  ended,
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
      case SessionActivity.subagent:
        return const Color(0xFFBB9AF7); // purple
      case SessionActivity.compacting:
        return const Color(0xFF7AA2F7); // blue
      case SessionActivity.ended:
        return const Color(0xFF565F89); // grey (same as idle)
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
      case SessionActivity.subagent:
        return 'Subagent';
      case SessionActivity.compacting:
        return 'Compacting';
      case SessionActivity.ended:
        return 'Ended';
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

/// Bridges the server-reported [AgentActivityStatus] (carried on a
/// [SessionSummary]) onto the status-bar [SessionActivity]. Used to SEED the
/// in-session pip from the session's last-known activity when the view opens,
/// so a session opened mid-run shows its real state (e.g. a long subagent run)
/// instead of "Idle" until the next live hook transition arrives.
extension AgentActivityStatusPip on AgentActivityStatus {
  SessionActivity toSessionActivity() {
    switch (this) {
      case AgentActivityStatus.running:
        return SessionActivity.running;
      case AgentActivityStatus.waiting:
        return SessionActivity.waiting;
      case AgentActivityStatus.error:
        return SessionActivity.error;
      case AgentActivityStatus.subagent:
        return SessionActivity.subagent;
      case AgentActivityStatus.compacting:
        return SessionActivity.compacting;
      case AgentActivityStatus.ended:
        return SessionActivity.ended;
      case AgentActivityStatus.idle:
      case AgentActivityStatus.none:
        return SessionActivity.idle;
    }
  }
}
