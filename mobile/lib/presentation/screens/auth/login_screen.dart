import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:remote_dev/presentation/providers/providers.dart';

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

  /// Opens Chrome Custom Tabs for CF Access auth, then receives
  /// credentials back via a `remotedev://auth/callback` deep link.
  Future<void> _loginWithCfAccess() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _isLoading = true;
      _error = null;
    });

    StreamSubscription<Uri>? sub;
    try {
      // Listen for the deep link callback from the server
      final appLinks = AppLinks();
      final completer = Completer<Uri>();
      sub = appLinks.uriLinkStream.listen((uri) {
        if (uri.scheme == 'remotedev' &&
            uri.host == 'auth' &&
            !completer.isCompleted) {
          completer.complete(uri);
        }
      });

      // Open Chrome Custom Tabs to the server's mobile callback page.
      // CF Access will intercept → authenticate → redirect to callback
      // → server exchanges token → redirects to remotedev://auth/callback
      final callbackUrl = Uri.parse('$_baseUrl/auth/mobile-callback');
      final launched = await launchUrl(
        callbackUrl,
        mode: LaunchMode.externalApplication,
      );

      if (!launched) {
        if (!mounted) return;
        setState(() => _error = 'Could not open browser');
        return;
      }

      // Wait for the deep link callback (timeout after 2 minutes)
      final callbackUri = await completer.future.timeout(
        const Duration(minutes: 2),
      );

      final apiKey = callbackUri.queryParameters['apiKey'];
      final userId = callbackUri.queryParameters['userId'] ?? '';
      final email = callbackUri.queryParameters['email'] ?? '';

      if (apiKey == null || apiKey.isEmpty) {
        if (!mounted) return;
        setState(() => _error = 'Authentication failed: no API key received');
        return;
      }

      await _storeCredentialsAndLogin(
        apiKey: apiKey,
        userId: userId,
        email: email,
      );
    } on TimeoutException {
      if (!mounted) return;
      setState(() => _error = 'Authentication timed out');
    } on Exception catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Authentication failed: $e');
    } finally {
      await sub?.cancel();
      if (mounted) setState(() => _isLoading = false);
    }
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
      final firstSession =
          sessions.isNotEmpty ? sessions[0] as Map<String, dynamic>? : null;
      final userId = firstSession?['userId'] as String? ?? '';

      await _storeCredentialsAndLogin(
        apiKey: apiKey,
        userId: userId,
      );
    } on DioException catch (e) {
      if (!mounted) return;
      final statusCode = e.response?.statusCode;
      if (statusCode == 401 || statusCode == 403) {
        setState(() => _error = 'Invalid API key');
      } else {
        setState(() => _error = 'Connection failed: ${e.message}');
      }
    } on Exception catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Connection failed: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

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
                    // App icon with container
                    Center(
                      child: Container(
                        width: 88,
                        height: 88,
                        decoration: BoxDecoration(
                          color: colorScheme.primaryContainer
                              .withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(24),
                        ),
                        child: Icon(
                          Icons.terminal,
                          size: 48,
                          color: colorScheme.primary,
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),
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
                        color: colorScheme.onSurface.withValues(alpha: 0.6),
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 36),

                    // Server URL
                    TextFormField(
                      controller: _serverUrlController,
                      decoration: const InputDecoration(
                        labelText: 'Server URL',
                        hintText: 'https://dev.example.com',
                        prefixIcon: Icon(Icons.dns_outlined),
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
                      ),
                      keyboardType: TextInputType.number,
                    ),
                    const SizedBox(height: 24),

                    // Error display
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 12,
                          ),
                          decoration: BoxDecoration(
                            color: colorScheme.errorContainer
                                .withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                Icons.error_outline,
                                size: 20,
                                color: colorScheme.error,
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Text(
                                  _error!,
                                  style: TextStyle(
                                    color: colorScheme.error,
                                    fontSize: 13,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),

                    // CF Access button
                    FilledButton.icon(
                      onPressed: _isLoading ? null : _loginWithCfAccess,
                      icon: const Icon(Icons.shield_outlined),
                      label: const Text('Sign in with Cloudflare Access'),
                    ),
                    const SizedBox(height: 16),

                    // API Key expandable section
                    AnimatedSize(
                      duration: const Duration(milliseconds: 250),
                      curve: Curves.easeInOut,
                      alignment: Alignment.topCenter,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          TextButton(
                            onPressed: () => setState(
                              () => _showApiKeyForm = !_showApiKeyForm,
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  _showApiKeyForm
                                      ? 'Hide API key form'
                                      : 'Or enter API key directly',
                                ),
                                const SizedBox(width: 4),
                                AnimatedRotation(
                                  turns: _showApiKeyForm ? 0.5 : 0,
                                  duration: const Duration(milliseconds: 250),
                                  child: const Icon(
                                    Icons.expand_more,
                                    size: 20,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          if (_showApiKeyForm) ...[
                            const SizedBox(height: 12),
                            TextFormField(
                              controller: _apiKeyController,
                              decoration: const InputDecoration(
                                labelText: 'API Key',
                                hintText: 'rdv_...',
                                prefixIcon: Icon(Icons.key_outlined),
                              ),
                              obscureText: true,
                              autocorrect: false,
                            ),
                            const SizedBox(height: 12),
                            OutlinedButton.icon(
                              onPressed:
                                  _isLoading ? null : _loginWithApiKey,
                              icon: const Icon(Icons.login),
                              label: const Text('Connect with API Key'),
                            ),
                          ],
                        ],
                      ),
                    ),

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
