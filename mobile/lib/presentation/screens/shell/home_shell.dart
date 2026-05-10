import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../channels/channels_tab_screen.dart';
import '../notifications/notifications_tab_screen.dart';
import '../profile/profile_tab_screen.dart';
import '../sessions/sessions_tab_screen.dart';
import 'adaptive_bottom_bar.dart';

/// Extra logical pixels reserved below the last row of every tab's primary
/// scrollable so it doesn't visually butt up against the bottom nav bar.
const double kTabContentBottomPad = 16;

/// Returns the bottom padding tab screens should apply so their last row
/// clears both the host shell's bottom navigation bar and the system bottom
/// inset (Android gesture inset / iOS home indicator).
///
/// Inside [HomeShell.Scaffold] the system bottom inset is consumed by the
/// scaffold (because it owns `bottomNavigationBar`), so reading
/// `MediaQuery.paddingOf(context).bottom` from a tab body returns 0. We
/// capture the inset above the scaffold and re-expose it via
/// [_ShellChromeInsets].
double tabContentBottomPadding(BuildContext context) {
  return _ShellChromeInsets.of(context) + kTabContentBottomPad;
}

/// Inherited carrier for the system bottom inset captured above
/// [HomeShell.Scaffold]. Tab screens read it via [tabContentBottomPadding].
class _ShellChromeInsets extends InheritedWidget {
  const _ShellChromeInsets({
    required this.systemBottomInset,
    required super.child,
  });

  final double systemBottomInset;

  static double of(BuildContext context) {
    final w = context.dependOnInheritedWidgetOfExactType<_ShellChromeInsets>();
    return w?.systemBottomInset ?? 0;
  }

  @override
  bool updateShouldNotify(_ShellChromeInsets old) =>
      old.systemBottomInset != systemBottomInset;
}

class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({this.initialTab, super.key});

  /// Tab to display on first build. Defaults to [HomeTab.sessions].
  /// Used by deep-link / push-notification tap routes that target a specific
  /// tab inside the shell (e.g. `/notifications` → notifications tab).
  final HomeTab? initialTab;

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  late HomeTab _active = widget.initialTab ?? HomeTab.sessions;

  @override
  Widget build(BuildContext context) {
    // Capture the system bottom inset BEFORE the Scaffold so tab screens can
    // read it. Once Scaffold owns `bottomNavigationBar`, Flutter zeroes out
    // the bottom padding on the body's MediaQuery, so the same call inside
    // a tab screen would always return 0.
    final systemBottomInset = MediaQuery.paddingOf(context).bottom;

    // Intercept system back gesture (Android predictive back / hardware back):
    // when the user is on a non-default tab, pop should switch back to the
    // sessions tab instead of letting go_router pop HomeShell off the stack
    // (which would exit the app). Only when already on the sessions tab do we
    // allow the system to handle the pop normally.
    final canPop = _active == HomeTab.sessions;
    return PopScope(
      canPop: canPop,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        if (_active != HomeTab.sessions) {
          setState(() => _active = HomeTab.sessions);
        }
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF1A1B26),
        body: SafeArea(
          bottom: false,
          child: _ShellChromeInsets(
            systemBottomInset: systemBottomInset,
            child: IndexedStack(
              index: _active.index,
              children: const [
                SessionsTabScreen(),
                ChannelsTabScreen(),
                NotificationsTabScreen(),
                ProfileTabScreen(),
              ],
            ),
          ),
        ),
        bottomNavigationBar: AdaptiveBottomBar(
          activeTab: _active,
          onTabSelected: (tab) => setState(() => _active = tab),
        ),
      ),
    );
  }
}
