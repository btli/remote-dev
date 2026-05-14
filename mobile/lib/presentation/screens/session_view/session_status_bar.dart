import 'package:flutter/material.dart';

import 'activity_pip.dart';

/// Identifiers for the overflow-menu entries surfaced from the status
/// bar (bd remote-dev-eygp). The status bar widget stays UI-only — the
/// host screen receives the picked id via [SessionStatusBar.onMenuAction]
/// and runs the API call / navigation.
enum SessionMenuAction { suspend, viewRecordings, delete }

/// Custom 44px chrome rendered above the session WebView.
///
/// This screen does not use a Material [AppBar] — the WebView height is
/// computed from a fixed budget (44 status + 44 smart-keys + 56 input)
/// and an AppBar would push everything down (Spec §4). So we provide the
/// back-arrow affordance inline. When [onBack] is not supplied, tapping
/// the leading icon falls back to [Navigator.maybePop] so the route's
/// previous entry handles the back gesture exactly like an AppBar's
/// implicit back button would.
///
/// Trailing overflow menu (bd remote-dev-eygp) is rendered whenever
/// [onMenuAction] is non-null. Surfaces Suspend / View Recordings /
/// Delete to bring Flutter parity with the PWA's `MobileSessionView`
/// header. The widget itself stays declarative — the host screen owns
/// the API calls and navigation.
class SessionStatusBar extends StatelessWidget {
  const SessionStatusBar({
    required this.projectName,
    required this.sessionName,
    required this.activity,
    this.onTap,
    this.onBack,
    this.onMenuAction,
    super.key,
  });

  final String? projectName;
  final String sessionName;
  final SessionActivity activity;
  final VoidCallback? onTap;

  /// Override for the leading back button. When null, the button calls
  /// `Navigator.of(context).maybePop()`.
  final VoidCallback? onBack;

  /// Invoked with the picked overflow-menu entry. When null, no overflow
  /// menu is rendered (keeps tests / surfaces that don't need actions
  /// pixel-identical to the legacy bar).
  final ValueChanged<SessionMenuAction>? onMenuAction;

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
            if (onMenuAction != null)
              PopupMenuButton<SessionMenuAction>(
                tooltip: 'More actions',
                icon: const Icon(
                  Icons.more_vert,
                  color: Colors.white,
                  size: 20,
                ),
                color: const Color(0xFF24283B),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                onSelected: onMenuAction,
                itemBuilder: (_) => const [
                  PopupMenuItem(
                    value: SessionMenuAction.suspend,
                    child: ListTile(
                      contentPadding: EdgeInsets.zero,
                      visualDensity: VisualDensity.compact,
                      leading: Icon(
                        Icons.pause_circle_outline,
                        color: Colors.white70,
                        size: 20,
                      ),
                      title: Text(
                        'Suspend',
                        style: TextStyle(color: Colors.white, fontSize: 14),
                      ),
                    ),
                  ),
                  PopupMenuItem(
                    value: SessionMenuAction.viewRecordings,
                    child: ListTile(
                      contentPadding: EdgeInsets.zero,
                      visualDensity: VisualDensity.compact,
                      leading: Icon(
                        Icons.movie_outlined,
                        color: Colors.white70,
                        size: 20,
                      ),
                      title: Text(
                        'View Recordings',
                        style: TextStyle(color: Colors.white, fontSize: 14),
                      ),
                    ),
                  ),
                  PopupMenuDivider(),
                  PopupMenuItem(
                    value: SessionMenuAction.delete,
                    child: ListTile(
                      contentPadding: EdgeInsets.zero,
                      visualDensity: VisualDensity.compact,
                      leading: Icon(
                        Icons.delete_outline,
                        color: Color(0xFFF7768E),
                        size: 20,
                      ),
                      title: Text(
                        'Delete',
                        style: TextStyle(
                          color: Color(0xFFF7768E),
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
