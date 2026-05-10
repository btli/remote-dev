import 'package:flutter/material.dart';

import 'activity_pip.dart';

/// Custom 44px chrome rendered above the session WebView.
///
/// This screen does not use a Material [AppBar] — the WebView height is
/// computed from a fixed budget (44 status + 44 smart-keys + 56 input)
/// and an AppBar would push everything down (Spec §4). So we provide the
/// back-arrow affordance inline. When [onBack] is not supplied, tapping
/// the leading icon falls back to [Navigator.maybePop] so the route's
/// previous entry handles the back gesture exactly like an AppBar's
/// implicit back button would.
class SessionStatusBar extends StatelessWidget {
  const SessionStatusBar({
    required this.projectName,
    required this.sessionName,
    required this.activity,
    this.onTap,
    this.onBack,
    super.key,
  });

  final String? projectName;
  final String sessionName;
  final SessionActivity activity;
  final VoidCallback? onTap;

  /// Override for the leading back button. When null, the button calls
  /// `Navigator.of(context).maybePop()`.
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF24283B),
      child: SizedBox(
        height: 44,
        child: Row(
          children: [
            IconButton(
              icon: const Icon(Icons.arrow_back, color: Colors.white, size: 20),
              tooltip: 'Back',
              padding: const EdgeInsets.symmetric(horizontal: 12),
              constraints: const BoxConstraints.tightFor(height: 44),
              splashRadius: 20,
              onPressed: onBack ?? () => Navigator.of(context).maybePop(),
            ),
            Expanded(
              child: InkWell(
                onTap: onTap,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Row(
                    children: [
                      ActivityPip(activity: activity),
                      const SizedBox(width: 8),
                      if (projectName != null) ...[
                        Flexible(
                          child: Text(
                            projectName!,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white70,
                              fontSize: 13,
                            ),
                          ),
                        ),
                        const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 6),
                          child: Text(
                            '·',
                            style:
                                TextStyle(color: Colors.white38, fontSize: 13),
                          ),
                        ),
                      ],
                      Flexible(
                        child: Text(
                          sessionName,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      const Icon(
                        Icons.expand_more,
                        color: Colors.white38,
                        size: 18,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
