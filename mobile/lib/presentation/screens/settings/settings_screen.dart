import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/presentation/providers/providers.dart';

const _availableFonts = [
  'JetBrainsMono Nerd Font',
  'FiraCode Nerd Font',
  'MesloLGS Nerd Font',
];

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  Future<void> _signOut(BuildContext context, WidgetRef ref) async {
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
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final config = ref.watch(serverConfigProvider).valueOrNull;
    final selectedFont = ref.watch(terminalFontProvider);
    final fontSize = ref.watch(terminalFontSizeProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        children: [
          // Connection section
          const _SectionHeader(
            icon: Icons.dns_outlined,
            label: 'Connection',
          ),
          const SizedBox(height: 8),
          Card.filled(
            color: colorScheme.surfaceContainerLow,
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.dns_outlined),
                  title: const Text('Server'),
                  trailing: Text(
                    config?.serverUrl ?? 'Not connected',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: colorScheme.onSurface.withValues(alpha: 0.7),
                    ),
                  ),
                ),
                Divider(
                  height: 1,
                  indent: 56,
                  color: colorScheme.outlineVariant,
                ),
                ListTile(
                  leading: const Icon(Icons.person_outline),
                  title: const Text('Email'),
                  trailing: Text(
                    config?.email ?? 'Unknown',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: colorScheme.onSurface.withValues(alpha: 0.7),
                    ),
                  ),
                ),
                Divider(
                  height: 1,
                  indent: 56,
                  color: colorScheme.outlineVariant,
                ),
                ListTile(
                  leading: const Icon(Icons.settings_ethernet),
                  title: const Text('Terminal Port'),
                  trailing: Text(
                    config?.terminalPort ?? '6002',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: colorScheme.onSurface.withValues(alpha: 0.7),
                    ),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),

          // Terminal section
          const _SectionHeader(
            icon: Icons.terminal,
            label: 'Terminal',
          ),
          const SizedBox(height: 8),
          Card.filled(
            color: colorScheme.surfaceContainerLow,
            child: Column(
              children: [
                // Font picker using M3 DropdownMenu
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                  child: Row(
                    children: [
                      Icon(
                        Icons.font_download_outlined,
                        color: colorScheme.onSurface.withValues(alpha: 0.6),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: DropdownMenu<String>(
                          initialSelection: selectedFont,
                          label: const Text('Font'),
                          expandedInsets: EdgeInsets.zero,
                          onSelected: (value) {
                            if (value != null) {
                              ref.read(terminalFontProvider.notifier).state =
                                  value;
                            }
                          },
                          dropdownMenuEntries: _availableFonts
                              .map(
                                (font) => DropdownMenuEntry(
                                  value: font,
                                  label: font.replaceAll(' Nerd Font', ''),
                                  labelWidget: Text(
                                    font.replaceAll(' Nerd Font', ''),
                                    style: TextStyle(
                                      fontFamily: font,
                                      fontSize: 14,
                                    ),
                                  ),
                                ),
                              )
                              .toList(),
                        ),
                      ),
                    ],
                  ),
                ),
                Divider(
                  height: 1,
                  indent: 56,
                  color: colorScheme.outlineVariant,
                ),
                // Font size slider
                ListTile(
                  leading: const Icon(Icons.format_size),
                  title: const Text('Font Size'),
                  trailing: Text(
                    '${fontSize.round()}',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: colorScheme.primary,
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(56, 0, 16, 12),
                  child: Slider(
                    value: fontSize,
                    min: 10,
                    max: 24,
                    divisions: 14,
                    label: '${fontSize.round()} pt',
                    onChanged: (value) {
                      ref.read(terminalFontSizeProvider.notifier).state = value;
                    },
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),

          // Account section
          const _SectionHeader(
            icon: Icons.account_circle_outlined,
            label: 'Account',
          ),
          const SizedBox(height: 8),
          Card.filled(
            color: colorScheme.errorContainer.withValues(alpha: 0.15),
            child: ListTile(
              leading: Icon(
                Icons.logout,
                color: colorScheme.error,
              ),
              title: Text(
                'Sign Out',
                style: TextStyle(color: colorScheme.error),
              ),
              subtitle: Text(
                config?.email ?? '',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: colorScheme.error.withValues(alpha: 0.6),
                ),
              ),
              onTap: () => _signOut(context, ref),
            ),
          ),

          const SizedBox(height: 32),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Row(
        children: [
          Icon(
            icon,
            size: 16,
            color: theme.colorScheme.primary,
          ),
          const SizedBox(width: 8),
          Text(
            label,
            style: theme.textTheme.labelLarge?.copyWith(
              color: theme.colorScheme.primary,
              fontWeight: FontWeight.bold,
              letterSpacing: 0.5,
            ),
          ),
        ],
      ),
    );
  }
}
