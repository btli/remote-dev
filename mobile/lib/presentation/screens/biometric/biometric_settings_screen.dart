import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/biometric_settings.dart';
import 'biometric_lock_overlay.dart';

/// Profile → Security screen. Lets the user toggle the biometric lock,
/// pick the grace period, and decide whether cold starts always require
/// authentication.
class BiometricSettingsScreen extends ConsumerStatefulWidget {
  const BiometricSettingsScreen({super.key});

  @override
  ConsumerState<BiometricSettingsScreen> createState() =>
      _BiometricSettingsScreenState();
}

class _BiometricSettingsScreenState
    extends ConsumerState<BiometricSettingsScreen> {
  BiometricSettings? _settings;
  bool _loading = true;
  String? _error;

  /// Grace-period choices users can pick from. 0 means "lock immediately on
  /// resume".
  static const _gracePresets = <_GracePreset>[
    _GracePreset(label: 'Immediately', seconds: 0),
    _GracePreset(label: 'After 1 minute', seconds: 60),
    _GracePreset(label: 'After 5 minutes', seconds: 300),
    _GracePreset(label: 'After 15 minutes', seconds: 900),
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final settings = await ref.read(biometricSettingsStoreProvider).load();
      if (!mounted) return;
      setState(() {
        _settings = settings;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _save(BiometricSettings updated) async {
    setState(() => _settings = updated);
    await ref.read(biometricSettingsStoreProvider).save(updated);
    // Refresh the read-side provider so anyone watching it sees the new
    // values. The overlay reads on demand and doesn't need invalidation.
    ref.invalidate(biometricSettingsProvider);
  }

  /// Guards the master Biometric-lock switch. iOS-style convention: enabling
  /// requires proof (availability check + a successful auth challenge);
  /// disabling is free.
  Future<void> _handleEnabledChanged(
    BiometricSettings current,
    bool next,
  ) async {
    if (!next) {
      await _save(current.copyWith(enabled: false));
      return;
    }
    final port = ref.read(biometricPortProvider);
    final available = await port.isAvailable();
    if (!mounted) return;
    if (!available) {
      _snack('No biometrics enrolled on this device');
      return;
    }
    final ok = await port.authenticate(reason: 'Enable biometric lock');
    if (!mounted) return;
    if (!ok) {
      _snack('Authentication failed — biometric lock not enabled');
      return;
    }
    await _save(current.copyWith(enabled: true));
  }

  void _snack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Security', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            'Failed to load: $_error',
            style: const TextStyle(color: Colors.white70),
          ),
        ),
      );
    }
    final settings = _settings!;
    return ListView(
      children: [
        SwitchListTile(
          value: settings.enabled,
          onChanged: (v) => _handleEnabledChanged(settings, v),
          title: const Text(
            'Biometric lock',
            style: TextStyle(color: Colors.white),
          ),
          subtitle: const Text(
            'Require Face ID, fingerprint, or device passcode to open the app.',
            style: TextStyle(color: Colors.white60),
          ),
        ),
        const Divider(color: Colors.white12, height: 1),
        ListTile(
          enabled: settings.enabled,
          title: Text(
            'Re-lock after',
            style: TextStyle(
              color: settings.enabled ? Colors.white : Colors.white38,
            ),
          ),
          subtitle: Text(
            _gracePresets
                .firstWhere(
                  (p) => p.seconds == settings.gracePeriodSeconds,
                  orElse: () => _GracePreset(
                    label: '${settings.gracePeriodSeconds}s',
                    seconds: settings.gracePeriodSeconds,
                  ),
                )
                .label,
            style: TextStyle(
              color: settings.enabled ? Colors.white60 : Colors.white24,
            ),
          ),
          trailing: Icon(
            Icons.chevron_right,
            color: settings.enabled ? Colors.white38 : Colors.white12,
          ),
          onTap: settings.enabled ? () => _pickGracePeriod(settings) : null,
        ),
        const Divider(color: Colors.white12, height: 1),
        SwitchListTile(
          value: settings.requireOnColdStart,
          onChanged: settings.enabled
              ? (v) => _save(settings.copyWith(requireOnColdStart: v))
              : null,
          title: Text(
            'Require on cold start',
            style: TextStyle(
              color: settings.enabled ? Colors.white : Colors.white38,
            ),
          ),
          subtitle: Text(
            'Lock the app every time it launches from a fully-quit state.',
            style: TextStyle(
              color: settings.enabled ? Colors.white60 : Colors.white24,
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _pickGracePeriod(BiometricSettings settings) async {
    final selected = await showModalBottomSheet<int>(
      context: context,
      backgroundColor: const Color(0xFF1A1B26),
      builder: (sheetCtx) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final preset in _gracePresets)
                ListTile(
                  title: Text(
                    preset.label,
                    style: const TextStyle(color: Colors.white),
                  ),
                  trailing: preset.seconds == settings.gracePeriodSeconds
                      ? const Icon(Icons.check, color: Color(0xFF7AA2F7))
                      : null,
                  onTap: () => Navigator.of(sheetCtx).pop(preset.seconds),
                ),
            ],
          ),
        );
      },
    );
    if (selected != null) {
      await _save(settings.copyWith(gracePeriodSeconds: selected));
    }
  }
}

class _GracePreset {
  const _GracePreset({required this.label, required this.seconds});

  final String label;
  final int seconds;
}
