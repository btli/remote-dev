import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
            _SessionsPlaceholder(),
            _ComingSoon(name: 'Channels'),
            _ComingSoon(name: 'Notifications'),
            _ComingSoon(name: 'Profile'),
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

class _SessionsPlaceholder extends StatelessWidget {
  const _SessionsPlaceholder();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Text(
        'Sessions tab — P2.2 wires the real list',
        style: TextStyle(color: Colors.white70),
      ),
    );
  }
}

class _ComingSoon extends StatelessWidget {
  const _ComingSoon({required this.name});
  final String name;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          '$name — coming in Phase 4',
          style: const TextStyle(color: Colors.white54),
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}
