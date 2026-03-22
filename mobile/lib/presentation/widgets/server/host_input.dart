import 'package:flutter/material.dart';

/// Host input field with recent history suggestions.
///
/// Shows a dropdown of previously used hosts below the field.
/// Tapping a suggestion fills the field without typing.
class HostInput extends StatefulWidget {
  const HostInput({
    super.key,
    required this.controller,
    this.recentHosts = const [],
    this.label,
    this.hintText = 'dev.example.com',
    this.enabled = true,
    this.onSubmitted,
    this.focusNode,
  });

  final TextEditingController controller;
  final List<String> recentHosts;
  final String? label;
  final String hintText;
  final bool enabled;
  final ValueChanged<String>? onSubmitted;
  final FocusNode? focusNode;

  @override
  State<HostInput> createState() => _HostInputState();
}

class _HostInputState extends State<HostInput> {
  late FocusNode _focusNode;

  @override
  void initState() {
    super.initState();
    _focusNode = widget.focusNode ?? FocusNode();
    _focusNode.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    if (widget.focusNode == null) {
      _focusNode.dispose();
    }
    super.dispose();
  }

  List<String> _getFilteredHosts() {
    final query = widget.controller.text.trim().toLowerCase();
    if (query.isEmpty) return widget.recentHosts;
    return widget.recentHosts
        .where((h) => h.toLowerCase().contains(query))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final filtered = _getFilteredHosts();
    final showSuggestions = _focusNode.hasFocus && filtered.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.label != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              widget.label!,
              style: theme.textTheme.labelMedium?.copyWith(
                color: colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        TextField(
          controller: widget.controller,
          focusNode: _focusNode,
          enabled: widget.enabled,
          keyboardType: TextInputType.url,
          autocorrect: false,
          enableSuggestions: false,
          textInputAction: TextInputAction.next,
          style: theme.textTheme.bodyLarge?.copyWith(
            fontFamily: 'JetBrainsMono Nerd Font',
          ),
          decoration: InputDecoration(
            hintText: widget.hintText,
            hintStyle: theme.textTheme.bodyLarge?.copyWith(
              fontFamily: 'JetBrainsMono Nerd Font',
              color: colorScheme.onSurface.withValues(alpha: 0.38),
            ),
            suffixIcon: widget.controller.text.isNotEmpty
                ? IconButton(
                    icon: const Icon(Icons.clear_rounded, size: 18),
                    onPressed: () {
                      widget.controller.clear();
                      setState(() {});
                    },
                  )
                : null,
          ),
          onChanged: (_) => setState(() {}),
          onSubmitted: widget.onSubmitted,
        ),
        if (showSuggestions)
          Container(
            margin: const EdgeInsets.only(top: 4),
            constraints: const BoxConstraints(maxHeight: 160),
            decoration: BoxDecoration(
              color: colorScheme.surfaceContainerHigh,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: colorScheme.outlineVariant),
            ),
            child: ListView.builder(
              shrinkWrap: true,
              padding: const EdgeInsets.symmetric(vertical: 4),
              itemCount: filtered.length,
              itemBuilder: (context, index) {
                final host = filtered[index];
                return ListTile(
                  dense: true,
                  visualDensity: VisualDensity.compact,
                  leading: Icon(
                    Icons.history_rounded,
                    size: 18,
                    color: colorScheme.onSurfaceVariant,
                  ),
                  title: Text(
                    host,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontFamily: 'JetBrainsMono Nerd Font',
                    ),
                  ),
                  onTap: () {
                    widget.controller.text = host;
                    widget.controller.selection = TextSelection.fromPosition(
                      TextPosition(offset: host.length),
                    );
                    _focusNode.unfocus();
                  },
                );
              },
            ),
          ),
      ],
    );
  }
}
