import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../channels/channels_tab_screen.dart';
import '../notifications/notifications_tab_screen.dart';
import '../profile/profile_tab_screen.dart';
import '../sessions/sessions_tab_screen.dart';
import 'adaptive_bottom_bar.dart';

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
        bottomNavigationBar: AdaptiveBottomBar(
          activeTab: _active,
          onTabSelected: (tab) => setState(() => _active = tab),
        ),
      ),
    );
  }
}
