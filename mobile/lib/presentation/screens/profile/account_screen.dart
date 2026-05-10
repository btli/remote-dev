import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../domain/account.dart';
import '../../../domain/server_config.dart';
import '../../../infrastructure/api/account_api.dart';
import '../webview_host/session_route_host.dart'
    show activeServerProvider, secureStorageProvider;

/// Provider for the AccountApi. Must be overridden in main.dart's
/// [buildServerScopedOverrides] once a [RemoteDevClient] is wired for the
/// active server. Following the same pattern as [sessionsApiProvider].
final accountApiProvider = Provider<AccountApi>((ref) {
  throw UnimplementedError(
    'accountApiProvider must be overridden with AccountApi(client) in main.dart',
  );
});

/// Loads the active server's account. autoDispose so a sign-out (which
/// invalidates [activeServerProvider]) drops cached data immediately.
final accountFutureProvider = FutureProvider.autoDispose<Account>((ref) async {
  return ref.watch(accountApiProvider).me();
});

/// Test seam: production wires a real [CookieManager.instance()]. Tests
/// override this to avoid hitting the platform channel.
final cookieManagerProvider = Provider<CookieManager?>((_) => null);

class AccountScreen extends ConsumerStatefulWidget {
  const AccountScreen({super.key});

  @override
  ConsumerState<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends ConsumerState<AccountScreen> {
  bool _signingOut = false;

  Future<void> _refresh() async {
    ref.invalidate(accountFutureProvider);
    await ref.read(accountFutureProvider.future);
  }

  Future<bool> _confirmSignOut(ServerConfig server) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF24283B),
        title: const Text(
          'Sign out of this server?',
          style: TextStyle(color: Colors.white),
        ),
        content: Text(
          'You will need to re-authenticate with Cloudflare Access to use '
          '"${server.label}" again.',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style:
                TextButton.styleFrom(foregroundColor: const Color(0xFFF7768E)),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  Future<void> _signOut(ServerConfig server) async {
    if (_signingOut) return;
    final confirmed = await _confirmSignOut(server);
    if (!confirmed || !mounted) return;

    setState(() => _signingOut = true);

    try {
      // 1. Drop the per-server CF auth cookie from secure storage so the
      //    Dio interceptor can no longer authenticate API calls.
      final storage = ref.read(secureStorageProvider);
      await storage.delete(server.id, 'cf_authorization');

      // 2. Best-effort: clear WebView cookies for *this* server's origin
      //    only. `deleteCookies(url:)` removes every cookie scoped to
      //    that origin (including the CF auth cookie) without touching
      //    cookies belonging to other servers the user has linked.
      try {
        final manager =
            ref.read(cookieManagerProvider) ?? CookieManager.instance();
        await manager.deleteCookies(url: WebUri(server.url));
      } catch (_) {
        // Cookie-clearing is best-effort. If the platform channel is
        // unavailable (e.g. in widget tests), we still want sign-out to
        // proceed since the secure-storage delete already revoked the
        // API client's auth.
      }

      // 3. Force a re-read of the active server so its auth header gets
      //    rebuilt the next time someone reads it.
      ref.invalidate(activeServerProvider);

      if (!mounted) return;
      // 4. Route back to the server picker.
      context.go('/servers');
    } catch (e) {
      if (!mounted) return;
      setState(() => _signingOut = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Sign out failed: $e'),
          duration: const Duration(seconds: 3),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final asyncServer = ref.watch(activeServerProvider);

    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Account', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      // Resolve the active server FIRST. Conflating loading/error with
      // "no server" would drop the user onto the empty-state CTA every
      // time the storage layer is still warming up or has actually
      // failed — both wrong.
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
          final asyncAccount = ref.watch(accountFutureProvider);
          return asyncAccount.when(
            loading: () => const Center(
              child: CupertinoActivityIndicator(color: Colors.white70),
            ),
            error: (err, _) => _ErrorView(
              message: 'Failed to load account',
              detail: '$err',
              onRetry: _refresh,
            ),
            data: (account) => _AccountBody(
              account: account,
              server: server,
              signingOut: _signingOut,
              onSignOut: () => _signOut(server),
            ),
          );
        },
      ),
    );
  }
}

class _AccountBody extends StatelessWidget {
  const _AccountBody({
    required this.account,
    required this.server,
    required this.signingOut,
    required this.onSignOut,
  });

  final Account account;
  final ServerConfig server;
  final bool signingOut;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        // Email — primary identity, large.
        SelectableText(
          account.email,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 22,
            fontWeight: FontWeight.w600,
          ),
        ),
        if (account.name != null && account.name!.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(
            account.name!,
            style: const TextStyle(color: Colors.white70, fontSize: 15),
          ),
        ],
        const SizedBox(height: 24),
        const Divider(color: Color(0xFF2F334D), height: 1),
        const SizedBox(height: 16),

        // Active server panel.
        const Text(
          'Active server',
          style: TextStyle(
            color: Colors.white60,
            fontSize: 12,
            letterSpacing: 0.6,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 8),
        _ServerCard(server: server),
        const SizedBox(height: 32),

        // Sign-out CTA.
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: signingOut ? null : onSignOut,
            icon: signingOut
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.logout),
            label: Text(
              signingOut ? 'Signing out…' : 'Sign out of this server',
            ),
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFF7768E),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
          ),
        ),
      ],
    );
  }
}

class _ServerCard extends StatelessWidget {
  const _ServerCard({required this.server});
  final ServerConfig server;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF24283B),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFF2F334D)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            server.label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 16,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          SelectableText(
            server.url,
            style: const TextStyle(color: Colors.white60, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

class _NoActiveServerView extends StatelessWidget {
  const _NoActiveServerView();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.cloud_off, size: 48, color: Colors.white24),
            const SizedBox(height: 16),
            const Text(
              'No active server',
              style: TextStyle(color: Colors.white70, fontSize: 16),
            ),
            const SizedBox(height: 8),
            const Text(
              'Pick a server before viewing account details.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white38, fontSize: 13),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: () => context.go('/servers'),
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF7AA2F7),
                foregroundColor: const Color(0xFF1A1B26),
              ),
              child: const Text('Choose a server'),
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
