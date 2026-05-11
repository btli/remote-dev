import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../domain/server_config.dart';
import '../../../infrastructure/auth/mobile_callback_login_launcher.dart';
import '../../../infrastructure/auth/mobile_credentials.dart';
import '../../../infrastructure/deep_link/deep_link_stream_provider.dart';
import '../webview_host/session_route_host.dart'
    show mobileCredentialsStoreProvider, serverConfigStoreProvider;
import 'server_picker_screen.dart' show serversListProvider;

/// Probes a candidate server URL with a short-timeout unauthenticated GET
/// against `/api/health` (and falls back to `/`). Returns true on a 2xx
/// response, false on any timeout / connection error / non-2xx.
///
/// Exposed as a top-level function so widget tests can override it via the
/// [healthProbeOverride] hook on [AddServerScreen] without spinning up a real
/// HTTP server.
Future<bool> defaultHealthProbe(String rawUrl) async {
  final base = Uri.tryParse(rawUrl);
  if (base == null || !base.hasScheme || !base.hasAuthority) return false;
  final dio = Dio(
    BaseOptions(
      baseUrl: base.toString(),
      connectTimeout: const Duration(seconds: 5),
      receiveTimeout: const Duration(seconds: 5),
      sendTimeout: const Duration(seconds: 5),
      // Treat any 2xx-3xx as a positive signal; explicit 4xx/5xx still throw.
      validateStatus: (s) => s != null && s >= 200 && s < 400,
    ),
  );
  try {
    await dio.get<dynamic>('/api/health');
    return true;
  } on DioException {
    // Fall back to root — some deployments don't expose /api/health
    // unauthenticated but do return a redirect from `/`.
    try {
      await dio.get<dynamic>('/');
      return true;
    } on DioException {
      return false;
    } catch (_) {
      return false;
    }
  } catch (_) {
    return false;
  } finally {
    dio.close(force: true);
  }
}

/// Bridge typedef so tests can stub the system-browser callback flow
/// without launching the platform browser. Returns the credentials
/// captured from `remotedev://auth/callback`, or `null` if the user
/// cancelled / the flow timed out.
typedef MobileCallbackLauncher = Future<MobileCredentials?> Function(
  Uri serverUrl,
);

class AddServerScreen extends ConsumerStatefulWidget {
  const AddServerScreen({
    required this.onSaved,
    this.healthProbeOverride,
    this.mobileCallbackLauncher,
    super.key,
  });

  final void Function(ServerConfig) onSaved;

  /// Test seam — replaces [defaultHealthProbe] when supplied.
  final Future<bool> Function(String url)? healthProbeOverride;

  /// Test seam — replaces the system-browser + deep-link callback when
  /// supplied. In production we construct a [MobileCallbackLoginLauncher]
  /// against the shared `deepLinkStreamProvider` and url_launcher.
  final MobileCallbackLauncher? mobileCallbackLauncher;

  @override
  ConsumerState<AddServerScreen> createState() => _AddServerScreenState();
}

class _AddServerScreenState extends ConsumerState<AddServerScreen> {
  final _formKey = GlobalKey<FormState>();
  final _urlCtrl = TextEditingController();
  final _labelCtrl = TextEditingController();
  bool _saving = false;
  String? _probeError;

  Future<bool> _runProbe(String url) async {
    final probe = widget.healthProbeOverride ?? defaultHealthProbe;
    return probe(url);
  }

  Future<MobileCredentials?> _runCallbackLogin(Uri serverUrl) async {
    final override = widget.mobileCallbackLauncher;
    if (override != null) return override(serverUrl);
    final launcher = MobileCallbackLoginLauncher(
      deepLinkStream: ref.read(deepLinkStreamProvider),
    );
    return launcher.login(serverUrl: serverUrl);
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _saving = true;
      _probeError = null;
    });
    try {
      final url = _urlCtrl.text.trim();
      final reachable = await _runProbe(url);
      if (!reachable) {
        if (!mounted) return;
        setState(() {
          _probeError = "Couldn't reach $url. The server may be offline, "
              'unreachable from this network, or behind a login wall.';
        });
        final shouldSave = await _confirmSaveAnyway();
        if (shouldSave != true) {
          return;
        }
      }

      // Open the system browser to <server>/auth/mobile-callback and
      // wait for the `remotedev://auth/callback` deep link the server
      // emits after a successful CF Access challenge.
      if (!mounted) return;
      final credentials = await _runCallbackLogin(Uri.parse(url));
      if (!mounted) return;
      if (credentials == null) {
        setState(() {
          _probeError = 'Sign-in cancelled.';
        });
        return;
      }

      final config = ServerConfig(
        id: const Uuid().v4(),
        label: _labelCtrl.text.trim(),
        url: url,
        lastUsedAt: DateTime.now(),
      );

      // Persist credentials BEFORE upserting the server record so that
      // any listener that reacts to a new server (e.g. Dio building a
      // client for it) finds the API key + cookie already in place.
      final credentialsStore = ref.read(mobileCredentialsStoreProvider);
      await credentialsStore.save(config.id, credentials);

      final store = ref.read(serverConfigStoreProvider);
      await store.upsert(config);
      await store.setActive(config.id);
      ref.invalidate(serversListProvider);
      if (mounted) widget.onSaved(config);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<bool?> _confirmSaveAnyway() {
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text("Can't reach this server"),
        content: Text(
          _probeError ??
              "We couldn't reach this URL. Save it anyway?",
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Save anyway'),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    _labelCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Add server', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: Form(
        key: _formKey,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _urlCtrl,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Server URL',
                  hintText: 'https://dev.example.com',
                ),
                validator: (v) {
                  final uri = Uri.tryParse(v ?? '');
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
              if (_probeError != null) ...[
                const SizedBox(height: 16),
                Text(
                  _probeError!,
                  style: const TextStyle(color: Colors.redAccent),
                ),
              ],
              const SizedBox(height: 32),
              ElevatedButton(
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Save'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

