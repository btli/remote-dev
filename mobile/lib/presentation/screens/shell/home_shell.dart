import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../channels/channels_tab_screen.dart';
import '../notifications/notifications_tab_screen.dart';
import '../profile/profile_tab_screen.dart';
import '../sessions/sessions_tab_screen.dart';
import 'adaptive_bottom_bar.dart';

class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  HomeTab _active = HomeTab.sessions;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
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
    );
  }
}
