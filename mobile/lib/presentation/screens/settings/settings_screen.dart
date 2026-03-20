import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/presentation/providers/providers.dart';
import 'package:remote_dev/presentation/theme/app_theme.dart';

/// Available terminal fonts (those we have TTF assets for).
const _availableFonts = [
  'JetBrainsMono Nerd Font',
  'FiraCode Nerd Font',
  'MesloLGS Nerd Font',
];

/// Settings screen with server info, font picker, and sign out.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  String _selectedFont = NerdFonts.defaultFont;
  double _fontSize = 14.0;

  Future<void> _signOut() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out'),
        content: const Text('Are you sure you want to sign out?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await ref.read(authNotifierProvider.notifier).signOut();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final config = ref.watch(serverConfigProvider).valueOrNull;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Server info section
          Text(
            'Connection',
            style: theme.textTheme.titleSmall?.copyWith(
              color: theme.colorScheme.primary,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          _InfoTile(
            icon: Icons.dns_outlined,
            label: 'Server',
            value: config?.serverUrl ?? 'Not connected',
          ),
          _InfoTile(
            icon: Icons.person_outline,
            label: 'Email',
            value: config?.email ?? 'Unknown',
          ),
          _InfoTile(
            icon: Icons.settings_ethernet,
            label: 'Terminal Port',
            value: config?.terminalPort ?? '6002',
          ),

          const SizedBox(height: 24),

          // Terminal section
          Text(
            'Terminal',
            style: theme.textTheme.titleSmall?.copyWith(
              color: theme.colorScheme.primary,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),

          // Font picker
          ListTile(
            leading: const Icon(Icons.font_download_outlined),
            title: const Text('Font'),
            trailing: DropdownButton<String>(
              value: _selectedFont,
              underline: const SizedBox.shrink(),
              onChanged: (value) {
                if (value != null) {
                  setState(() => _selectedFont = value);
                }
              },
              items: _availableFonts
                  .map(
                    (font) => DropdownMenuItem(
                      value: font,
                      child: Text(
                        font.replaceAll(' Nerd Font', ''),
                        style: TextStyle(fontFamily: font, fontSize: 14),
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),

          // Font size slider
          ListTile(
            leading: const Icon(Icons.format_size),
            title: const Text('Font Size'),
            subtitle: Slider(
              value: _fontSize,
              min: 10,
              max: 24,
              divisions: 14,
              label: _fontSize.round().toString(),
              onChanged: (value) {
                setState(() => _fontSize = value);
              },
            ),
            trailing: Text(
              '${_fontSize.round()}',
              style: theme.textTheme.bodyMedium,
            ),
          ),

          const SizedBox(height: 24),

          // Sign out
          FilledButton.icon(
            onPressed: _signOut,
            icon: const Icon(Icons.logout),
            label: const Text('Sign Out'),
            style: FilledButton.styleFrom(
              backgroundColor: theme.colorScheme.error,
              foregroundColor: theme.colorScheme.onError,
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoTile extends StatelessWidget {
  const _InfoTile({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(
            icon,
            size: 20,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
          ),
          const SizedBox(width: 12),
          Text(
            label,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
            ),
          ),
          const Spacer(),
          Flexible(
            child: Text(
              value,
              style: theme.textTheme.bodyMedium,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.end,
            ),
          ),
        ],
      ),
    );
  }
}
