import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/host_config.dart';
import '../../../domain/qr_payload.dart';
import '../../../infrastructure/auth/mobile_callback_login_launcher.dart'
    show MobileCallbackLoginLauncher, generateLoginState;
import '../../../infrastructure/auth/pending_add_host_login.dart';
import '../../../infrastructure/deep_link/deep_link_stream_provider.dart';
import '../scan/qr_scan_screen.dart';
import '../webview_host/session_route_host.dart'
    show pendingAddHostLoginStoreProvider;

/// Test seam — fires the system browser at `<origin>/auth/mobile-callback` with
/// the given anti-forgery [state]. Returns whether the browser launched. The
/// returning `remotedev://auth/callback` is completed by the app-global
/// `AddHostLoginCompleter`, NOT by this screen.
typedef InteractiveLoginLauncher = Future<bool> Function(Uri origin, String state);

/// Adds a connection target by ORIGIN + label.
///
/// STATE-INDEPENDENT design (remote-dev): the returning `remotedev://auth/callback`
/// deep link recreates the Android activity / rebuilds this GoRouter page, which
/// disposes this screen's `State`. So this screen is now only a THIN TRIGGER:
///
///   1. validate the form,
///   2. write a persistent [PendingAddHostLogin] record (origin, label,
///      anti-forgery `state` nonce) to secure storage BEFORE launching, then
///   3. fire the system browser (fire-and-forget).
///
/// The WHOLE remainder — persist host + cookies, probe `GET /api/instances`,
/// activate the single workspace (or route to the supervisor picker), and
/// NAVIGATE to the session — runs in the app-global `AddHostLoginCompleter`,
/// which survives this screen's disposal. Only a callback whose echoed `state`
/// matches the pending record's nonce completes the add (anti-forgery).
class AddHostScreen extends ConsumerStatefulWidget {
  const AddHostScreen({
    this.launchLogin,
    this.stateGenerator,
    super.key,
  });

  /// Test seam — replaces the system-browser launch.
  final InteractiveLoginLauncher? launchLogin;

  /// Test seam — replaces the anti-forgery nonce generator (so a test can assert
  /// the exact nonce persisted in the pending record).
  final String Function()? stateGenerator;

  @override
  ConsumerState<AddHostScreen> createState() => _AddHostScreenState();
}

class _AddHostScreenState extends ConsumerState<AddHostScreen> {
  final _formKey = GlobalKey<FormState>();
  final _originCtrl = TextEditingController();
  final _labelCtrl = TextEditingController();
  bool _busy = false;

  /// True once the browser has been launched and we are waiting for the global
  /// completer to finish (which navigates away). Shown so the user isn't left
  /// staring at the form; a Cancel affordance clears the pending record.
  bool _waiting = false;
  String? _error;

  Future<bool> _runLaunch(Uri origin, String state) {
    final override = widget.launchLogin;
    if (override != null) return override(origin, state);
    final launcher = MobileCallbackLoginLauncher(
      deepLinkStream: ref.read(deepLinkStreamProvider),
    );
    return launcher.launchInteractiveLogin(origin: origin, state: state);
  }

  String _generateState() =>
      (widget.stateGenerator ?? generateLoginState).call();

  /// Scan a provisioning QR code to speed up adding a host.
  ///
  /// The add flow signs in through the system browser (OIDC / CF Access) and
  /// mints its own key, so a LEGACY `{url, port, apiKey}` QR can't inject its
  /// key here — but we can prefill the Host URL so the user just taps Add to
  /// continue through the normal login. A CF service-token QR belongs to an
  /// EXISTING host, so we point the user to add the host first.
  Future<void> _scanQr() async {
    final payload = await QrScanScreen.push(context);
    if (!mounted || payload == null) return;

    switch (payload) {
      case LegacyServerPayload(:final url):
        setState(() {
          _originCtrl.text = url;
          if (_labelCtrl.text.trim().isEmpty) {
            _labelCtrl.text = Uri.tryParse(url)?.host ?? '';
          }
          _error = null;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Scanned server URL. Tap Add to sign in and finish.'),
          ),
        );
      case CfServiceTokenPayload(:final host):
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'That QR is a Cloudflare service token for $host. Add the host '
              'first, then apply it from Edit host → Scan QR.',
            ),
          ),
        );
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });

    final origin = HostConfig.normalizeOrigin(_originCtrl.text.trim());
    final label = _labelCtrl.text.trim();
    final state = _generateState();
    final store = ref.read(pendingAddHostLoginStoreProvider);

    // Persist the pending record BEFORE launching, so the app-global completer
    // can finish the flow even if this screen is disposed on the callback
    // return. The record carries the anti-forgery nonce the completer matches.
    await store.save(
      PendingAddHostLogin(
        origin: origin,
        label: label,
        state: state,
        createdAtMs: DateTime.now().millisecondsSinceEpoch,
      ),
    );
    debugPrint('[AddHostFlow] pending record written origin=$origin');

    bool launched;
    try {
      launched = await _runLaunch(Uri.parse(origin), state);
    } catch (e) {
      debugPrint('[AddHostFlow] launch threw: $e');
      launched = false;
    }
    if (!mounted) return;
    if (!launched) {
      // Roll back the pending record so a stale one can't shadow a later add.
      await store.clear();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'Could not open the browser to sign in. Please try again.';
      });
      return;
    }
    debugPrint('[AddHostFlow] browser launched; awaiting global completion');
    setState(() {
      _busy = false;
      _waiting = true;
    });
  }

  /// Cancel a launched-but-not-yet-completed sign-in: clear the pending record
  /// (so it can't be honoured later) and return to the form.
  Future<void> _cancelWaiting() async {
    await ref.read(pendingAddHostLoginStoreProvider).clear();
    if (!mounted) return;
    setState(() => _waiting = false);
  }

  @override
  void dispose() {
    _originCtrl.dispose();
    _labelCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Add host', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: const Icon(Icons.qr_code_scanner, color: Colors.white),
            tooltip: 'Scan QR code',
            onPressed: (_busy || _waiting) ? null : _scanQr,
          ),
        ],
      ),
      body: _waiting ? _buildWaiting() : _buildForm(),
    );
  }

  Widget _buildWaiting() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 24),
            const Text(
              'Complete sign-in in your browser…',
              style: TextStyle(color: Colors.white, fontSize: 16),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            const Text(
              "You'll return here automatically.",
              style: TextStyle(color: Colors.white54),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            OutlinedButton(
              onPressed: _cancelWaiting,
              child: const Text('Cancel'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildForm() {
    return Form(
      key: _formKey,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextFormField(
              controller: _originCtrl,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'Host URL',
                hintText: 'https://dev.example.com',
              ),
              validator: (v) {
                final uri = Uri.tryParse((v ?? '').trim());
                if (uri == null || !uri.hasScheme || !uri.hasAuthority) {
                  return 'Enter a valid URL with scheme and host';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _labelCtrl,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(labelText: 'Label'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(_error!, style: const TextStyle(color: Colors.redAccent)),
            ],
            const SizedBox(height: 32),
            ElevatedButton(
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Add'),
            ),
          ],
        ),
      ),
    );
  }
}
