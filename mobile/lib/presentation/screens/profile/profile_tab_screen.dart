import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class ProfileTabScreen extends ConsumerWidget {
  const ProfileTabScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Profile', style: TextStyle(color: Colors.white)),
      ),
      body: ListView(
        // Reserve space below the last row so it never tucks under the host
        // shell's bottom nav bar (or the Android gesture inset).
        padding: EdgeInsets.only(
          bottom: MediaQuery.paddingOf(context).bottom + 16,
        ),
        children: [
          _ProfileRow(
            icon: Icons.person,
            label: 'Account',
            // push so the AppBar shows an implicit back arrow that pops
            // to the Profile tab inside HomeShell.
            onTap: () => context.push('/home/profile/account'),
          ),
          _ProfileRow(
            icon: Icons.code,
            label: 'GitHub accounts',
            onTap: () => context.push('/home/profile/github'),
          ),
          _ProfileRow(
            icon: Icons.palette_outlined,
            label: 'Appearance',
            onTap: () => context.push('/home/profile/appearance'),
          ),
          _ProfileRow(
            icon: Icons.cloud_outlined,
            label: 'Servers',
            onTap: () => context.push('/home/profile/servers'),
          ),
          _ProfileRow(
            icon: Icons.lock_outline,
            label: 'Security',
            onTap: () => context.push('/home/profile/biometric'),
          ),
          _ProfileRow(
            icon: Icons.info_outline,
            label: 'About',
            onTap: () => context.push('/home/profile/about'),
          ),
        ],
      ),
    );
  }
}

class _ProfileRow extends StatelessWidget {
  const _ProfileRow({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: Colors.white70),
      title: Text(label, style: const TextStyle(color: Colors.white)),
      trailing: const Icon(Icons.chevron_right, color: Colors.white38),
      onTap: onTap,
    );
  }
}
