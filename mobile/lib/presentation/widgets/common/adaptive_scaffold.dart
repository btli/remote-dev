import 'package:flutter/material.dart';

/// Breakpoint for phone vs tablet layout.
const kTabletBreakpoint = 768.0;

/// Adaptive layout that switches between phone and tablet presentations.
///
/// - Phone: sidebar is hidden (accessible via drawer)
/// - Tablet: sidebar is persistent alongside the main content
class AdaptiveScaffold extends StatelessWidget {
  const AdaptiveScaffold({
    super.key,
    required this.sidebar,
    required this.body,
    this.title,
    this.actions,
    this.floatingActionButton,
    this.sidebarWidth = 280.0,
  });

  final Widget sidebar;
  final Widget body;
  final Widget? title;
  final List<Widget>? actions;
  final Widget? floatingActionButton;
  final double sidebarWidth;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isTablet = constraints.maxWidth >= kTabletBreakpoint;

        if (isTablet) {
          return _TabletLayout(
            sidebar: sidebar,
            body: body,
            sidebarWidth: sidebarWidth,
            actions: actions,
            floatingActionButton: floatingActionButton,
          );
        }

        return _PhoneLayout(
          sidebar: sidebar,
          body: body,
          title: title,
          actions: actions,
          floatingActionButton: floatingActionButton,
        );
      },
    );
  }
}

class _TabletLayout extends StatelessWidget {
  const _TabletLayout({
    required this.sidebar,
    required this.body,
    required this.sidebarWidth,
    this.actions,
    this.floatingActionButton,
  });

  final Widget sidebar;
  final Widget body;
  final double sidebarWidth;
  final List<Widget>? actions;
  final Widget? floatingActionButton;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      floatingActionButton: floatingActionButton,
      body: Row(
        children: [
          SizedBox(
            width: sidebarWidth,
            child: sidebar,
          ),
          VerticalDivider(
            width: 1,
            color: theme.dividerColor.withValues(alpha: 0.1),
          ),
          Expanded(child: body),
        ],
      ),
    );
  }
}

class _PhoneLayout extends StatelessWidget {
  const _PhoneLayout({
    required this.sidebar,
    required this.body,
    this.title,
    this.actions,
    this.floatingActionButton,
  });

  final Widget sidebar;
  final Widget body;
  final Widget? title;
  final List<Widget>? actions;
  final Widget? floatingActionButton;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: title,
        actions: actions,
      ),
      drawer: Drawer(
        child: sidebar,
      ),
      floatingActionButton: floatingActionButton,
      body: body,
    );
  }
}
