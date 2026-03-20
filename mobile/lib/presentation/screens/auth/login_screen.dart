import 'package:flutter/material.dart';

/// Login screen with two auth paths:
/// 1. Cloudflare Access (opens WebView for SSO)
/// 2. Direct API Key (for LAN connections)
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
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

  Future<void> _loginWithCfAccess() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _isLoading = true;
      _error = null;
    });

    // TODO: Launch InAppWebView for CF Access flow
    // 1. Open server URL in WebView
    // 2. CF Access redirects for SSO login
    // 3. Extract CF_Authorization cookie
    // 4. POST /api/auth/mobile-exchange with token
    // 5. Store returned API key

    setState(() => _isLoading = false);
  }

  Future<void> _loginWithApiKey() async {
    if (!_formKey.currentState!.validate()) return;
    if (_apiKeyController.text.isEmpty) {
      setState(() => _error = 'API key is required');
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    // TODO: Validate API key by calling GET /api/sessions
    // On success: store credentials and navigate to sessions

    setState(() => _isLoading = false);
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
