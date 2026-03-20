import 'package:remote_dev/domain/errors/app_error.dart';

/// Appearance settings from the server.
class AppearanceData {
  final String appearanceMode; // 'light', 'dark', 'system'
  final String lightColorScheme;
  final String darkColorScheme;
  final int terminalOpacity;
  final int terminalBlur;
  final String terminalCursorStyle;

  const AppearanceData({
    required this.appearanceMode,
    required this.lightColorScheme,
    required this.darkColorScheme,
    this.terminalOpacity = 100,
    this.terminalBlur = 0,
    this.terminalCursorStyle = 'block',
  });
}

/// User preferences from the server.
class PreferencesData {
  final String? defaultWorkingDirectory;
  final String? defaultShell;
  final String? fontFamily;
  final int fontSize;
  final String? defaultAgentProvider;

  const PreferencesData({
    this.defaultWorkingDirectory,
    this.defaultShell,
    this.fontFamily,
    this.fontSize = 14,
    this.defaultAgentProvider,
  });
}

/// Abstract gateway for appearance and preference operations.
abstract interface class AppearanceGateway {
  Future<Result<AppearanceData>> getAppearance();
  Future<Result<PreferencesData>> getPreferences();
}
