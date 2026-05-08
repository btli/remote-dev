import 'dart:ui';

import 'package:flutter/material.dart';

/// A reusable frosted glass container using BackdropFilter.
///
/// Provides configurable blur, opacity, border, and border radius.
/// Use over terminal or dark backgrounds for the glassmorphism effect.
///
/// Surface presets:
/// - [GlassmorphicContainer.drawer] — Session drawer (sigma: 20, 0.75)
/// - [GlassmorphicContainer.sheet] — Bottom sheets (sigma: 24, 0.80)
/// - [GlassmorphicContainer.dialog] — Dialogs (sigma: 16, 0.85)
/// - [GlassmorphicContainer.panel] — Quick actions panel (sigma: 20, 0.75)
/// - [GlassmorphicContainer.statusBar] — Floating status overlay (sigma: 12, 0.60)
class GlassmorphicContainer extends StatelessWidget {
  const GlassmorphicContainer({
    super.key,
    required this.child,
    this.blurSigma = 20.0,
    this.opacity = 0.75,
    this.borderRadius = BorderRadius.zero,
    this.borderColor,
    this.borderWidth = 1.0,
    this.backgroundColor,
    this.padding,
    this.margin,
    this.width,
    this.height,
    this.clipBehavior = Clip.antiAlias,
  });

  /// Session drawer surface.
  const GlassmorphicContainer.drawer({
    super.key,
    required this.child,
    this.borderRadius = const BorderRadius.only(
      topRight: Radius.circular(20),
      bottomRight: Radius.circular(20),
    ),
    this.padding,
    this.margin,
    this.width,
    this.height,
    this.clipBehavior = Clip.antiAlias,
  })  : blurSigma = 20.0,
        opacity = 0.75,
        borderColor = null,
        borderWidth = 1.0,
        backgroundColor = null;

  /// Bottom sheet surface.
  const GlassmorphicContainer.sheet({
    super.key,
    required this.child,
    this.borderRadius = const BorderRadius.vertical(
      top: Radius.circular(20),
    ),
    this.padding,
    this.margin,
    this.width,
    this.height,
    this.clipBehavior = Clip.antiAlias,
  })  : blurSigma = 24.0,
        opacity = 0.80,
        borderColor = null,
        borderWidth = 1.0,
        backgroundColor = null;

  /// Dialog surface.
  const GlassmorphicContainer.dialog({
    super.key,
    required this.child,
    this.borderRadius = const BorderRadius.all(Radius.circular(20)),
    this.padding,
    this.margin,
    this.width,
    this.height,
    this.clipBehavior = Clip.antiAlias,
  })  : blurSigma = 16.0,
        opacity = 0.85,
        borderColor = null,
        borderWidth = 1.0,
        backgroundColor = null;

  /// Quick actions panel surface.
  const GlassmorphicContainer.panel({
    super.key,
    required this.child,
    this.borderRadius = const BorderRadius.only(
      topLeft: Radius.circular(20),
      bottomLeft: Radius.circular(20),
    ),
    this.padding,
    this.margin,
    this.width,
    this.height,
    this.clipBehavior = Clip.antiAlias,
  })  : blurSigma = 20.0,
        opacity = 0.75,
        borderColor = null,
        borderWidth = 1.0,
        backgroundColor = null;

  /// Floating status bar overlay.
  const GlassmorphicContainer.statusBar({
    super.key,
    required this.child,
    this.borderRadius = const BorderRadius.all(Radius.circular(12)),
    this.padding,
    this.margin,
    this.width,
    this.height,
    this.clipBehavior = Clip.antiAlias,
  })  : blurSigma = 12.0,
        opacity = 0.60,
        borderColor = null,
        borderWidth = 0.0,
        backgroundColor = null;

  final Widget child;
  final double blurSigma;
  final double opacity;
  final BorderRadius borderRadius;
  final Color? borderColor;
  final double borderWidth;
  final Color? backgroundColor;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;
  final double? width;
  final double? height;
  final Clip clipBehavior;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    final bgColor = backgroundColor ??
        (isDark
            ? Colors.black.withValues(alpha: opacity)
            : Colors.white.withValues(alpha: opacity));

    final border = borderWidth > 0
        ? Border.all(
            color: borderColor ??
                (isDark
                    ? Colors.white.withValues(alpha: 0.08)
                    : Colors.black.withValues(alpha: 0.06)),
            width: borderWidth,
          )
        : null;

    return Container(
      width: width,
      height: height,
      margin: margin,
      child: ClipRRect(
        borderRadius: borderRadius,
        clipBehavior: clipBehavior,
        child: BackdropFilter(
          filter: ImageFilter.blur(
            sigmaX: blurSigma,
            sigmaY: blurSigma,
          ),
          child: Container(
            padding: padding,
            decoration: BoxDecoration(
              color: bgColor,
              borderRadius: borderRadius,
              border: border,
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}
