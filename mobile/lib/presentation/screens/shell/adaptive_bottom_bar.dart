import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

enum HomeTab { sessions, channels, notifications, profile }

class AdaptiveBottomBar extends StatelessWidget {
  const AdaptiveBottomBar({
    required this.activeTab,
    required this.onTabSelected,
    this.channelsBadge = 0,
    this.notificationsBadge = 0,
    super.key,
  });

  final HomeTab activeTab;
  final ValueChanged<HomeTab> onTabSelected;
  final int channelsBadge;
  final int notificationsBadge;

  void _select(HomeTab tab) {
    HapticFeedback.selectionClick();
    onTabSelected(tab);
  }

  bool _isCupertino(BuildContext context) =>
      Theme.of(context).platform == TargetPlatform.iOS ||
      Theme.of(context).platform == TargetPlatform.macOS;

  @override
  Widget build(BuildContext context) {
    if (_isCupertino(context)) {
      return CupertinoTabBar(
        backgroundColor: const Color(0xFF1A1B26).withValues(alpha: 0.92),
        currentIndex: activeTab.index,
        onTap: (i) => _select(HomeTab.values[i]),
        items: const [
          BottomNavigationBarItem(
            icon: Icon(CupertinoIcons.list_bullet),
            label: 'Sessions',
          ),
          BottomNavigationBarItem(
            icon: Icon(CupertinoIcons.chat_bubble_2),
            label: 'Channels',
          ),
          BottomNavigationBarItem(
            icon: Icon(CupertinoIcons.bell),
            label: 'Notifications',
          ),
          BottomNavigationBarItem(
            icon: Icon(CupertinoIcons.person),
            label: 'Profile',
          ),
        ],
      );
    }
    return NavigationBar(
      backgroundColor: const Color(0xFF1A1B26),
      selectedIndex: activeTab.index,
      onDestinationSelected: (i) => _select(HomeTab.values[i]),
      destinations: [
        const NavigationDestination(
          icon: Icon(Icons.list),
          label: 'Sessions',
        ),
        NavigationDestination(
          icon: _BadgedIcon(
            icon: const Icon(Icons.chat_bubble_outline),
            count: channelsBadge,
          ),
          label: 'Channels',
        ),
        NavigationDestination(
          icon: _BadgedIcon(
            icon: const Icon(Icons.notifications_none),
            count: notificationsBadge,
          ),
          label: 'Notifications',
        ),
        const NavigationDestination(
          icon: Icon(Icons.person_outline),
          label: 'Profile',
        ),
      ],
    );
  }
}

class _BadgedIcon extends StatelessWidget {
  const _BadgedIcon({required this.icon, required this.count});
  final Widget icon;
  final int count;

  @override
  Widget build(BuildContext context) {
    if (count <= 0) return icon;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        icon,
        Positioned(
          right: -6,
          top: -4,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
            decoration: const BoxDecoration(
              color: Color(0xFFF7768E), // Tokyo Night red
              borderRadius: BorderRadius.all(Radius.circular(8)),
            ),
            constraints: const BoxConstraints(minWidth: 16),
            child: Text(
              count > 99 ? '99+' : '$count',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white, fontSize: 10),
            ),
          ),
        ),
      ],
    );
  }
}
