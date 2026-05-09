import 'package:flutter/material.dart';

import 'activity_pip.dart';

class SessionStatusBar extends StatelessWidget {
  const SessionStatusBar({
    required this.projectName,
    required this.sessionName,
    required this.activity,
    this.onTap,
    super.key,
  });

  final String? projectName;
  final String sessionName;
  final SessionActivity activity;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF24283B),
      child: InkWell(
        onTap: onTap,
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(
            children: [
              ActivityPip(activity: activity),
              const SizedBox(width: 8),
              if (projectName != null) ...[
                Flexible(
                  child: Text(
                    projectName!,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white70, fontSize: 13),
                  ),
                ),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 6),
                  child: Text(
                    '·',
                    style: TextStyle(color: Colors.white38, fontSize: 13),
                  ),
                ),
              ],
              Flexible(
                child: Text(
                  sessionName,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.expand_more, color: Colors.white38, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}
