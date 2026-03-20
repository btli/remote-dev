import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/presentation/providers/providers.dart';

/// Login screen with two auth paths:
/// 1. Cloudflare Access (opens WebView for SSO)
/// 2. Direct API Key (for LAN connections)
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _serverUrlController = TextEditingController();
  final _terminalPortController = TextEditingController(text: '6002');
  final _apiKeyController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _isLoading = false;
  String? _error;
  bool _showApiKeyForm = false;

  @override
  void dispose() {
    _serverUrlController.dispose();
    _terminalPortController.dispose();
    _apiKeyController.dispose();
    super.dispose();
  }

  String get _baseUrl {
    final url = _serverUrlController.text.trim();
    return url.endsWith('/') ? url.substring(0, url.length - 1) : url;
  }

  String get _terminalPort => _terminalPortController.text.trim();

  Future<void> _storeCredentialsAndLogin({
    required String apiKey,
    String userId = '',
    String email = '',
  }) async {
    final storage = ref.read(secureStorageProvider);
    await storage.storeCredentials(
      serverUrl: _baseUrl,
      terminalPort: _terminalPort,
      apiKey: apiKey,
      userId: userId,
      email: email,
    );
    ref.read(authNotifierProvider.notifier).loginCompleted();
  }

  Future<void> _loginWithCfAccess() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final cfToken = await _showCfAccessWebView();
      if (cfToken == null) {
        setState(() {
          _isLoading = false;
          _error = 'Authentication cancelled';
        });
        return;
      }

      final dio = Dio(BaseOptions(baseUrl: _baseUrl));
      final response = await dio.post(
        '/api/auth/mobile-exchange',
        data: {'cfToken': cfToken},
      );

      final data = response.data as Map<String, dynamic>;
      await _storeCredentialsAndLogin(
        apiKey: data['apiKey'] as String,
        userId: data['userId'] as String,
        email: data['email'] as String,
      );
    } on DioException catch (e) {
      setState(
        () => _error = e.response?.data?['error'] as String? ??
            'Authentication failed: ${e.message}',
      );
    } on Exception catch (e) {
      setState(() => _error = 'Authentication failed: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  /// Opens an InAppWebView to the server URL, waits for CF Access to
  /// authenticate, then extracts the CF_Authorization cookie.
  Future<String?> _showCfAccessWebView() async {
    String? cfToken;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => SizedBox(
        height: MediaQuery.of(context).size.height * 0.9,
        child: Column(
          children: [
            AppBar(
              title: const Text('Sign in'),
              leading: IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ),
            Expanded(
              child: InAppWebView(
                initialUrlRequest: URLRequest(url: WebUri(_baseUrl)),
                initialSettings: InAppWebViewSettings(
                  javaScriptEnabled: true,
                  clearCache: true,
                ),
                onLoadStop: (controller, url) async {
                  // Check if we've been redirected back to the server
                  // (CF Access sets the cookie after successful auth)
                  if (url != null && url.toString().startsWith(_baseUrl)) {
                    final cookies = await CookieManager.instance().getCookies(
                      url: WebUri(_baseUrl),
                    );
                    for (final cookie in cookies) {
                      if (cookie.name == 'CF_Authorization') {
                        cfToken = cookie.value;
                        if (context.mounted) Navigator.of(context).pop();
                        return;
                      }
                    }
                  }
                },
              ),
            ),
          ],
        ),
      ),
    );

    // Clear WebView cookies after extracting the token
    await CookieManager.instance().deleteAllCookies();
    return cfToken;
  }

  Future<void> _loginWithApiKey() async {
    if (!_formKey.currentState!.validate()) return;
    final apiKey = _apiKeyController.text.trim();
    if (apiKey.isEmpty) {
      setState(() => _error = 'API key is required');
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      // Validate API key by calling GET /api/sessions
      final dio = Dio(
        BaseOptions(
          baseUrl: _baseUrl,
          headers: {'Authorization': 'Bearer $apiKey'},
        ),
      );
      final response = await dio.get('/api/sessions');
      final data = response.data as Map<String, dynamic>;

      final sessions = data['sessions'] as List? ?? [];
      final userId = sessions.isNotEmpty
          ? (sessions[0] as Map<String, dynamic>)['userId'] as String? ?? ''
          : '';

      await _storeCredentialsAndLogin(
        apiKey: apiKey,
        userId: userId,
      );
    } on DioException catch (e) {
      final statusCode = e.response?.statusCode;
      if (statusCode == 401 || statusCode == 403) {
        setState(() => _error = 'Invalid API key');
      } else {
        setState(() => _error = 'Connection failed: ${e.message}');
      }
    } on Exception catch (e) {
      setState(() => _error = 'Connection failed: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(
                      Icons.terminal,
                      size: 64,
                      color: theme.colorScheme.primary,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Remote Dev',
                      style: theme.textTheme.headlineMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Connect to your terminal server',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurface.withValues(
                          alpha: 0.6,
                        ),
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 32),

                    // Server URL
                    TextFormField(
                      controller: _serverUrlController,
                      decoration: const InputDecoration(
                        labelText: 'Server URL',
                        hintText: 'https://dev.example.com',
                        prefixIcon: Icon(Icons.dns_outlined),
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.url,
                      autocorrect: false,
                      validator: (value) {
                        if (value == null || value.isEmpty) {
                          return 'Server URL is required';
                        }
                        final uri = Uri.tryParse(value);
                        if (uri == null || !uri.hasScheme) {
                          return 'Enter a valid URL (https://...)';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 12),

                    // Terminal port
                    TextFormField(
                      controller: _terminalPortController,
                      decoration: const InputDecoration(
                        labelText: 'Terminal Port',
                        hintText: '6002',
                        prefixIcon: Icon(Icons.settings_ethernet),
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.number,
                    ),
                    const SizedBox(height: 24),

                    // Error display
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: Text(
                          _error!,
                          style: TextStyle(color: theme.colorScheme.error),
                          textAlign: TextAlign.center,
                        ),
                      ),

                    // CF Access button
                    FilledButton.icon(
                      onPressed: _isLoading ? null : _loginWithCfAccess,
                      icon: const Icon(Icons.shield_outlined),
                      label: const Text('Sign in with Cloudflare Access'),
                    ),
                    const SizedBox(height: 12),

                    // Toggle API key form
                    TextButton(
                      onPressed: () =>
                          setState(() => _showApiKeyForm = !_showApiKeyForm),
                      child: Text(
                        _showApiKeyForm
                            ? 'Hide API key form'
                            : 'Or enter API key directly',
                      ),
                    ),

                    // API Key form (expandable)
                    if (_showApiKeyForm) ...[
                      const SizedBox(height: 8),
                      TextFormField(
                        controller: _apiKeyController,
                        decoration: const InputDecoration(
                          labelText: 'API Key',
                          hintText: 'rdv_...',
                          prefixIcon: Icon(Icons.key_outlined),
                          border: OutlineInputBorder(),
                        ),
                        obscureText: true,
                        autocorrect: false,
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: _isLoading ? null : _loginWithApiKey,
                        icon: const Icon(Icons.login),
                        label: const Text('Connect with API Key'),
                      ),
                    ],

                    if (_isLoading)
                      const Padding(
                        padding: EdgeInsets.only(top: 16),
                        child: Center(child: CircularProgressIndicator()),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
