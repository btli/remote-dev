import 'package:freezed_annotation/freezed_annotation.dart';

part 'biometric_settings.freezed.dart';
part 'biometric_settings.g.dart';

/// User-tunable settings for the biometric lock overlay.
///
/// - [enabled] — master switch. When false, the overlay never shows.
/// - [gracePeriodSeconds] — how long the app can stay backgrounded before
///   re-locking on resume. 0 = lock immediately.
/// - [requireOnColdStart] — when true, lock on app launch even if nothing
///   has been backgrounded yet.
@freezed
class BiometricSettings with _$BiometricSettings {
  const factory BiometricSettings({
    @Default(false) bool enabled,
    @Default(60) int gracePeriodSeconds,
    @Default(true) bool requireOnColdStart,
  }) = _BiometricSettings;

  factory BiometricSettings.fromJson(Map<String, dynamic> json) =>
      _$BiometricSettingsFromJson(json);
}
