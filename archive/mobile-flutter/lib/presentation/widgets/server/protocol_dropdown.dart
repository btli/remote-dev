import 'package:flutter/material.dart';

/// Protocol selector dropdown: http:// or https://
///
/// Material 3 styled dropdown that avoids typing.
/// Defaults to https:// since most remote-dev instances use Cloudflare tunnels.
class ProtocolDropdown extends StatelessWidget {
  const ProtocolDropdown({
    super.key,
    required this.value,
    required this.onChanged,
    this.label,
    this.enabled = true,
  });

  final String value;
  final ValueChanged<String> onChanged;
  final String? label;
  final bool enabled;

  static const protocols = ['https://', 'http://'];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (label != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              label!,
              style: theme.textTheme.labelMedium?.copyWith(
                color: colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        Container(
          decoration: BoxDecoration(
            color: colorScheme.surfaceContainer,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: colorScheme.outlineVariant),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: value,
              onChanged: enabled ? (v) => onChanged(v!) : null,
              isExpanded: true,
              borderRadius: BorderRadius.circular(12),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              dropdownColor: colorScheme.surfaceContainerHigh,
              style: theme.textTheme.bodyLarge?.copyWith(
                fontFamily: 'JetBrainsMono Nerd Font',
                color: enabled
                    ? colorScheme.onSurface
                    : colorScheme.onSurface.withValues(alpha: 0.38),
              ),
              icon: Icon(
                Icons.keyboard_arrow_down_rounded,
                color: colorScheme.onSurfaceVariant,
              ),
              items: protocols
                  .map((p) => DropdownMenuItem(
                        value: p,
                        child: Text(p),
                      ))
                  .toList(),
            ),
          ),
        ),
      ],
    );
  }
}
