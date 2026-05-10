import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/github_account.dart';
import '../../../domain/server_config.dart';
import '../../../infrastructure/api/github_accounts_api.dart';
import '../webview_host/session_route_host.dart' show activeServerProvider;

/// Provider for the [GitHubAccountsApi]. Must be overridden in main.dart's
/// [buildServerScopedOverrides] once a [RemoteDevClient] is wired for the
/// active server. Mirrors the [accountApiProvider] / [sessionsApiProvider]
/// pattern.
final githubAccountsApiProvider = Provider<GitHubAccountsApi>((ref) {
  throw UnimplementedError(
    'githubAccountsApiProvider must be overridden with '
    'GitHubAccountsApi(client) in main.dart',
  );
});

/// Loads the active server's linked GitHub accounts. autoDispose so a
/// sign-out (which invalidates [activeServerProvider]) drops the cached
/// list immediately.
final githubAccountsFutureProvider =
    FutureProvider.autoDispose<List<GitHubAccount>>((ref) async {
  return ref.watch(githubAccountsApiProvider).list();
});

class GitHubAccountsScreen extends ConsumerStatefulWidget {
  const GitHubAccountsScreen({super.key});

  @override
  ConsumerState<GitHubAccountsScreen> createState() =>
      _GitHubAccountsScreenState();
}

class _GitHubAccountsScreenState extends ConsumerState<GitHubAccountsScreen> {
  /// Per-row mutation flag — set while a PATCH/DELETE is in flight so we
  /// can disable the row and avoid double-fires from rapid taps.
  String? _busyId;

  Future<void> _refresh() async {
    ref.invalidate(githubAccountsFutureProvider);
    await ref.read(githubAccountsFutureProvider.future);
  }

  Future<void> _setDefault(GitHubAccount account) async {
    if (account.isDefault) return;
    if (_busyId != null) return;
    setState(() => _busyId = account.id);
    try {
      await ref.read(githubAccountsApiProvider).setDefault(account.id);
      if (!mounted) return;
      await _refresh();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not set default: $e')),
      );
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _confirmAndUnlink(GitHubAccount account) async {
    if (_busyId != null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF24283B),
        title: Text(
          'Unlink @${account.login}?',
          style: const TextStyle(color: Colors.white),
        ),
        content: const Text(
          'Projects bound to this account will be unbound.',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(
              foregroundColor: const Color(0xFFF7768E),
            ),
            child: const Text('Unlink'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _busyId = account.id);
    try {
      await ref.read(githubAccountsApiProvider).unlink(account.id);
      if (!mounted) return;
      await _refresh();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not unlink: $e')),
      );
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _openLinkFlow(ServerConfig server) async {
    final didLink = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => _GitHubLinkWebView(server: server),
        fullscreenDialog: true,
      ),
    );
    // Refresh on close regardless — the user might have linked an account
    // and then dismissed via the system gesture, in which case `didLink`
    // is null but the list is still stale.
    if (!mounted) return;
    if (didLink == true || didLink == null) {
      await _refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    final asyncServer = ref.watch(activeServerProvider);
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text(
          'GitHub accounts',
          style: TextStyle(color: Colors.white),
        ),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      // Resolve the active server FIRST. Mirrors AccountScreen — conflating
      // loading/error with "no server" would render the empty-state CTA
      // every time storage is still warming up, which is the wrong signal.
      body: asyncServer.when(
        loading: () => const Center(
          child: CupertinoActivityIndicator(color: Colors.white70),
        ),
        error: (err, _) => _ErrorView(
          message: 'Failed to resolve active server',
          detail: '$err',
          onRetry: _refresh,
        ),
        data: (server) {
          if (server == null) {
            return const _NoActiveServerView();
          }
          final asyncAccounts = ref.watch(githubAccountsFutureProvider);
          return asyncAccounts.when(
            loading: () => const Center(
              child: CupertinoActivityIndicator(color: Colors.white70),
            ),
            error: (err, _) => _ErrorView(
              message: 'Failed to load GitHub accounts',
              detail: '$err',
              onRetry: _refresh,
            ),
            data: (accounts) {
              if (accounts.isEmpty) {
                return _EmptyState(
                  onLink: () => _openLinkFlow(server),
                );
              }
              return RefreshIndicator(
                onRefresh: _refresh,
                child: ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: accounts.length + 1,
                  separatorBuilder: (_, __) => const Divider(
                    color: Color(0xFF2F334D),
                    height: 1,
                    indent: 72,
                  ),
                  itemBuilder: (context, index) {
                    if (index == accounts.length) {
                      return Padding(
                        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                        child: OutlinedButton.icon(
                          onPressed: () => _openLinkFlow(server),
                          icon: const Icon(Icons.add),
                          label: const Text('Link another GitHub account'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: const Color(0xFF7AA2F7),
                            side: const BorderSide(color: Color(0xFF2F334D)),
                            padding:
                                const EdgeInsets.symmetric(vertical: 14),
                          ),
                        ),
                      );
                    }
                    final account = accounts[index];
                    return _AccountTile(
                      account: account,
                      busy: _busyId == account.id,
                      onTap: () => _setDefault(account),
                      onLongPress: () => _confirmAndUnlink(account),
                    );
                  },
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class _AccountTile extends StatelessWidget {
  const _AccountTile({
    required this.account,
    required this.busy,
    required this.onTap,
    required this.onLongPress,
  });

  final GitHubAccount account;
  final bool busy;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: busy ? null : onTap,
      onLongPress: busy ? null : onLongPress,
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
      leading: _Avatar(account: account),
      title: Text(
        '@${account.login}',
        style: const TextStyle(
          color: Colors.white,
          fontSize: 16,
          fontWeight: FontWeight.w500,
        ),
      ),
      trailing: busy
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: Colors.white70,
              ),
            )
          : (account.isDefault ? const _DefaultBadge() : null),
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.account});
  final GitHubAccount account;

  @override
  Widget build(BuildContext context) {
    final fallback = CircleAvatar(
      radius: 20,
      backgroundColor: const Color(0xFF2F334D),
      child: Text(
        account.login.isNotEmpty ? account.login[0].toUpperCase() : '?',
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
    final url = account.avatarUrl;
    if (url == null) return fallback;
    return CircleAvatar(
      radius: 20,
      backgroundColor: const Color(0xFF2F334D),
      // Use foregroundImage so a load failure cleanly falls back to the
      // child monogram (backgroundImage hides the child unconditionally,
      // which would leave broken avatars showing a blank circle).
      foregroundImage: NetworkImage(url),
      child: Text(
        account.login.isNotEmpty ? account.login[0].toUpperCase() : '?',
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _DefaultBadge extends StatelessWidget {
  const _DefaultBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: const Color(0xFF24283B),
        border: Border.all(color: const Color(0xFF7AA2F7)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: const Text(
        'default',
        style: TextStyle(
          color: Color(0xFF7AA2F7),
          fontSize: 11,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onLink});
  final VoidCallback onLink;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.link_off, size: 48, color: Colors.white24),
            const SizedBox(height: 16),
            const Text(
              'No linked GitHub accounts',
              style: TextStyle(color: Colors.white70, fontSize: 16),
            ),
            const SizedBox(height: 8),
            const Text(
              'Link a GitHub account to clone repositories and create '
              'worktrees from this device.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white38, fontSize: 13),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: onLink,
              icon: const Icon(Icons.add),
              label: const Text('Link a GitHub account'),
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF7AA2F7),
                foregroundColor: const Color(0xFF1A1B26),
                padding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 14,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NoActiveServerView extends StatelessWidget {
  const _NoActiveServerView();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.cloud_off, size: 48, color: Colors.white24),
            SizedBox(height: 16),
            Text(
              'No active server',
              style: TextStyle(color: Colors.white70, fontSize: 16),
            ),
            SizedBox(height: 8),
            Text(
              'Pick a server before managing GitHub accounts.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white38, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({
    required this.message,
    required this.detail,
    required this.onRetry,
  });
  final String message;
  final String detail;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: onRetry,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const SizedBox(height: 96),
          const Icon(Icons.error_outline, size: 48, color: Color(0xFFF7768E)),
          const SizedBox(height: 16),
          Center(
            child: Text(
              message,
              style: const TextStyle(color: Colors.white70, fontSize: 16),
            ),
          ),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Text(
              detail,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white38, fontSize: 12),
            ),
          ),
          const SizedBox(height: 24),
          Center(
            child: TextButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh, color: Color(0xFF7AA2F7)),
              label: const Text(
                'Retry',
                style: TextStyle(color: Color(0xFF7AA2F7)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Full-screen WebView for the GitHub OAuth link flow.
///
/// Loads `<server>/api/auth/github/link` (which kicks off the server-side
/// OAuth dance) and pops the route as soon as the WebView returns to a
/// URL that signals the link succeeded — either:
///   1. The intermediate `/api/auth/github/callback?code=&state=` URL,
///      which the server hits before redirecting to `/`, or
///   2. The final `/?github=connected` redirect target.
///
/// Either signal counts: the server only emits both *after* it has
/// already persisted the linked account, so popping on the first one we
/// see is safe.
class _GitHubLinkWebView extends StatefulWidget {
  const _GitHubLinkWebView({required this.server});
  final ServerConfig server;

  @override
  State<_GitHubLinkWebView> createState() => _GitHubLinkWebViewState();
}

/// Strict origin + path/query check for the OAuth completion URL.
///
/// Defends against the WebView popping "success" on an attacker-controlled
/// page that merely contains `/api/auth/github/callback` as a substring or
/// adds a `?github=connected` query under a different origin. Both signals
/// must come from the same host (and matching port, when both sides specify
/// one) as the active server. Visible for testing.
@visibleForTesting
bool isOAuthCallback(Uri uri, Uri serverOrigin) {
  // Same origin: scheme and host must match exactly.
  if (uri.scheme != serverOrigin.scheme) return false;
  if (uri.host.isEmpty || uri.host != serverOrigin.host) return false;
  // If both sides declare an explicit port, require equality. If only one
  // side does, treat the implicit port as the scheme default — Uri.port
  // returns the default for the URI's scheme when none is set, so a
  // straight `port` comparison handles that.
  if (uri.hasPort != serverOrigin.hasPort) {
    if (uri.port != serverOrigin.port) return false;
  } else if (uri.hasPort && uri.port != serverOrigin.port) {
    return false;
  }
  // Exact callback path.
  if (uri.path == '/api/auth/github/callback') return true;
  // Or root path with `?github=connected`.
  if ((uri.path == '/' || uri.path.isEmpty) &&
      uri.queryParameters['github'] == 'connected') {
    return true;
  }
  return false;
}

class _GitHubLinkWebViewState extends State<_GitHubLinkWebView> {
  bool _completed = false;

  void _maybeFinish(WebUri? url) {
    if (_completed) return;
    if (url == null) return;
    final serverOrigin = Uri.tryParse(widget.server.url);
    if (serverOrigin == null) return;
    if (!isOAuthCallback(url, serverOrigin)) return;
    _completed = true;
    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final linkUrl =
        Uri.parse(widget.server.url).resolve('/api/auth/github/link');
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        foregroundColor: Colors.white,
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () {
            if (_completed) return;
            _completed = true;
            Navigator.of(context).pop(false);
          },
        ),
        title: const Text(
          'Link GitHub account',
          style: TextStyle(color: Colors.white),
        ),
      ),
      body: SafeArea(
        child: InAppWebView(
          initialUrlRequest: URLRequest(url: WebUri(linkUrl.toString())),
          initialSettings: InAppWebViewSettings(
            useShouldOverrideUrlLoading: true,
            applicationNameForUserAgent: 'RemoteDevMobile/0.1.0',
          ),
          // Both hooks fire during the OAuth dance — onLoadStop is the
          // primary signal, but on Android the callback redirect often
          // resolves so fast we never see an onLoadStop for it. The
          // navigation hook catches that case.
          shouldOverrideUrlLoading: (controller, action) async {
            _maybeFinish(action.request.url);
            return NavigationActionPolicy.ALLOW;
          },
          onLoadStop: (controller, url) async {
            _maybeFinish(url);
          },
        ),
      ),
    );
  }
}
