import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../application/state/appearance_provider.dart';
import '../../../domain/appearance_settings.dart';

/// Tokyo Night palette anchors used across the appearance screen.
const _bg = Color(0xFF1A1B26);
const _surface = Color(0xFF24283B);
const _accent = Color(0xFF7AA2F7);
const _muted = Color(0xFF565F89);
const _textPrimary = Colors.white;
const _textSecondary = Color(0xFFC0CAF5);

class AppearanceScreen extends ConsumerWidget {
  const AppearanceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(appearanceSettingsProvider);
    final notifier = ref.read(appearanceSettingsProvider.notifier);

    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _bg,
        title: const Text('Appearance', style: TextStyle(color: _textPrimary)),
        iconTheme: const IconThemeData(color: _textPrimary),
        elevation: 0,
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          _SectionHeader(label: 'Display'),
          _FontScaleTile(
            value: settings.fontScale,
            onChanged: notifier.setFontScale,
          ),
          const Divider(color: _muted, height: 1),
          _SwitchTile(
            key: const Key('appearance.reduceMotion'),
            icon: Icons.motion_photos_off_outlined,
            label: 'Reduce motion',
            description: 'Shorten or disable animations.',
            value: settings.reduceMotion,
            onChanged: notifier.setReduceMotion,
          ),
          const Divider(color: _muted, height: 1),
          _SwitchTile(
            key: const Key('appearance.cursorBlink'),
            icon: Icons.text_fields,
            label: 'Cursor blink',
            description: 'Blink the terminal cursor.',
            value: settings.cursorBlink,
            onChanged: notifier.setCursorBlink,
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          color: _muted,
          fontSize: 12,
          fontWeight: FontWeight.w600,
          letterSpacing: 1.2,
        ),
      ),
    );
  }
}

class _FontScaleTile extends StatelessWidget {
  const _FontScaleTile({required this.value, required this.onChanged});

  final double value;
  final ValueChanged<double> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: _surface,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.format_size, color: _textSecondary),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'Font scale',
                  style: TextStyle(color: _textPrimary, fontSize: 16),
                ),
              ),
              Text(
                '${value.toStringAsFixed(2)}x',
                style: const TextStyle(color: _textSecondary, fontSize: 14),
              ),
            ],
          ),
          SliderTheme(
            data: SliderTheme.of(context).copyWith(
              activeTrackColor: _accent,
              inactiveTrackColor: _muted,
              thumbColor: _accent,
              overlayColor: _accent.withValues(alpha: 0.2),
              valueIndicatorColor: _accent,
              valueIndicatorTextStyle: const TextStyle(color: _bg),
            ),
            child: Slider(
              key: const Key('appearance.fontScale'),
              min: AppearanceSettings.minFontScale,
              max: AppearanceSettings.maxFontScale,
              divisions: 9, // 0.05 steps across 0.85 → 1.30
              label: '${value.toStringAsFixed(2)}x',
              value: value.clamp(
                AppearanceSettings.minFontScale,
                AppearanceSettings.maxFontScale,
              ),
              onChanged: onChanged,
            ),
          ),
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text(
              'Adjust app and terminal text size.',
              style: TextStyle(color: _muted, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

class _SwitchTile extends StatelessWidget {
  const _SwitchTile({
    super.key,
    required this.icon,
    required this.label,
    required this.description,
    required this.value,
    required this.onChanged,
  });

  final IconData icon;
  final String label;
  final String description;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: _surface,
      child: SwitchListTile(
        value: value,
        onChanged: onChanged,
        activeThumbColor: _accent,
        secondary: Icon(icon, color: _textSecondary),
        title: Text(
          label,
          style: const TextStyle(color: _textPrimary, fontSize: 16),
        ),
        subtitle: Text(
          description,
          style: const TextStyle(color: _muted, fontSize: 12),
        ),
      ),
    );
  }
}
