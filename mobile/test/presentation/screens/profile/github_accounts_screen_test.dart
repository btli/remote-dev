import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/domain/github_account.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/infrastructure/api/github_accounts_api.dart';
import 'package:remote_dev/presentation/screens/profile/github_accounts_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show activeServerProvider;

class _MockGitHubAccountsApi extends Mock implements GitHubAccountsApi {}

ServerConfig _server() => ServerConfig(
      id: 'srv-1',
      label: 'My Server',
      url: 'https://rdv.example',
      lastUsedAt: DateTime.utc(2026, 1, 1),
    );

Widget _wrap({
  required GitHubAccountsApi api,
  ServerConfig? server,
  bool serverPending = false,
}) {
  return ProviderScope(
    overrides: [
      githubAccountsApiProvider.overrideWithValue(api),
      activeServerProvider.overrideWith(
        (ref) => serverPending
            ? Completer<ServerConfig?>().future
            : SynchronousFuture<ServerConfig?>(server),
      ),
    ],
    child: const MaterialApp(home: GitHubAccountsScreen()),
  );
}

void main() {
  late _MockGitHubAccountsApi api;

  setUp(() {
    api = _MockGitHubAccountsApi();
  });

  testWidgets('shows loading indicator while accounts are in flight',
      (tester) async {
    final completer = Completer<List<GitHubAccount>>();
    when(() => api.list()).thenAnswer((_) => completer.future);

    await tester.pumpWidget(_wrap(api: api, server: _server()));
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump();

    expect(find.byType(CupertinoActivityIndicator), findsOneWidget);
  });

  testWidgets('renders empty state with link CTA when list is empty',
      (tester) async {
    when(() => api.list()).thenAnswer((_) async => const []);

    await tester.pumpWidget(_wrap(api: api, server: _server()));
    await tester.pumpAndSettle();

    expect(find.text('No linked GitHub accounts'), findsOneWidget);
    expect(find.text('Link a GitHub account'), findsOneWidget);
  });

  testWidgets('renders error view with retry on failure', (tester) async {
    when(() => api.list()).thenThrow(StateError('boom'));

    await tester.pumpWidget(_wrap(api: api, server: _server()));
    await tester.pumpAndSettle();

    expect(find.text('Failed to load GitHub accounts'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('renders @login rows and the default badge', (tester) async {
    when(() => api.list()).thenAnswer(
      (_) async => const [
        GitHubAccount(
          id: '1',
          login: 'octocat',
          avatarUrl: null,
          isDefault: true,
        ),
        GitHubAccount(
          id: '2',
          login: 'hubot',
          avatarUrl: null,
          isDefault: false,
        ),
      ],
    );

    await tester.pumpWidget(_wrap(api: api, server: _server()));
    await tester.pumpAndSettle();

    expect(find.text('@octocat'), findsOneWidget);
    expect(find.text('@hubot'), findsOneWidget);
    // Exactly one row has the default badge.
    expect(find.text('default'), findsOneWidget);
  });

  testWidgets('tapping a non-default row calls setDefault and refreshes',
      (tester) async {
    var listCalls = 0;
    when(() => api.list()).thenAnswer((_) async {
      listCalls++;
      // First call: hubot is non-default. After setDefault, second call
      // returns hubot as default — verifies the screen re-fetches.
      if (listCalls == 1) {
        return const [
          GitHubAccount(
            id: '1',
            login: 'octocat',
            avatarUrl: null,
            isDefault: true,
          ),
          GitHubAccount(
            id: '2',
            login: 'hubot',
            avatarUrl: null,
            isDefault: false,
          ),
        ];
      }
      return const [
        GitHubAccount(
          id: '1',
          login: 'octocat',
          avatarUrl: null,
          isDefault: false,
        ),
        GitHubAccount(
          id: '2',
          login: 'hubot',
          avatarUrl: null,
          isDefault: true,
        ),
      ];
    });
    when(() => api.setDefault('2')).thenAnswer((_) async {});

    await tester.pumpWidget(_wrap(api: api, server: _server()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('@hubot'));
    await tester.pumpAndSettle();

    verify(() => api.setDefault('2')).called(1);
    expect(listCalls, greaterThanOrEqualTo(2));
  });

  testWidgets('tapping the already-default row is a no-op', (tester) async {
    when(() => api.list()).thenAnswer(
      (_) async => const [
        GitHubAccount(
          id: '1',
          login: 'octocat',
          avatarUrl: null,
          isDefault: true,
        ),
      ],
    );

    await tester.pumpWidget(_wrap(api: api, server: _server()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('@octocat'));
    await tester.pumpAndSettle();

    verifyNever(() => api.setDefault(any()));
  });

  testWidgets('long-press shows confirm dialog; cancel does not call unlink',
      (tester) async {
    when(() => api.list()).thenAnswer(
      (_) async => const [
        GitHubAccount(
          id: '1',
          login: 'octocat',
          avatarUrl: null,
          isDefault: true,
        ),
      ],
    );

    await tester.pumpWidget(_wrap(api: api, server: _server()));
    await tester.pumpAndSettle();

    await tester.longPress(find.text('@octocat'));
    await tester.pumpAndSettle();

    expect(find.text('Unlink @octocat?'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();

    verifyNever(() => api.unlink(any()));
  });

  testWidgets('long-press → confirm calls unlink and refreshes',
      (tester) async {
    var listCalls = 0;
    when(() => api.list()).thenAnswer((_) async {
      listCalls++;
      if (listCalls == 1) {
        return const [
          GitHubAccount(
            id: '1',
            login: 'octocat',
            avatarUrl: null,
            isDefault: true,
          ),
        ];
      }
      return const [];
    });
    when(() => api.unlink('1')).thenAnswer((_) async {});

    await tester.pumpWidget(_wrap(api: api, server: _server()));
    await tester.pumpAndSettle();

    await tester.longPress(find.text('@octocat'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Unlink'));
    await tester.pumpAndSettle();

    verify(() => api.unlink('1')).called(1);
    // Confirms the post-unlink refresh ran and re-rendered with the
    // empty-state CTA.
    expect(find.text('No linked GitHub accounts'), findsOneWidget);
  });

  testWidgets('shows loading indicator while activeServerProvider is in '
      'flight (does NOT fall through to no-active-server)', (tester) async {
    when(() => api.list()).thenAnswer((_) async => const []);

    await tester.pumpWidget(_wrap(api: api, serverPending: true));
    await tester.pump();

    expect(find.byType(CupertinoActivityIndicator), findsOneWidget);
    expect(find.text('No active server'), findsNothing);
  });

  testWidgets('shows no-active-server view when server is null',
      (tester) async {
    when(() => api.list()).thenAnswer((_) async => const []);

    await tester.pumpWidget(_wrap(api: api, server: null));
    await tester.pumpAndSettle();

    expect(find.text('No active server'), findsOneWidget);
    expect(find.text('No linked GitHub accounts'), findsNothing);
  });

  group('isOAuthCallback', () {
    final serverOrigin = Uri.parse('https://rdv.example');

    test('rejects callback path on a foreign origin', () {
      expect(
        isOAuthCallback(
          Uri.parse('https://evil.test/api/auth/github/callback'),
          serverOrigin,
        ),
        isFalse,
      );
    });

    test('accepts exact callback path on the active server origin', () {
      expect(
        isOAuthCallback(
          Uri.parse('https://rdv.example/api/auth/github/callback?code=abc'),
          serverOrigin,
        ),
        isTrue,
      );
    });

    test('accepts root with ?github=connected on the active server origin',
        () {
      expect(
        isOAuthCallback(
          Uri.parse('https://rdv.example/?github=connected'),
          serverOrigin,
        ),
        isTrue,
      );
    });

    test('rejects ?github=connected on a foreign origin', () {
      expect(
        isOAuthCallback(
          Uri.parse('https://evil.test/?github=connected'),
          serverOrigin,
        ),
        isFalse,
      );
    });

    test('rejects callback path nested under a different prefix', () {
      // Same host, but the path is not exactly the callback path — used to
      // pass the loose substring match.
      expect(
        isOAuthCallback(
          Uri.parse(
            'https://rdv.example/some/random/path/api/auth/github/callback',
          ),
          serverOrigin,
        ),
        isFalse,
      );
    });

    test('rejects mismatched explicit ports on the same host', () {
      expect(
        isOAuthCallback(
          Uri.parse('https://rdv.example:8443/api/auth/github/callback'),
          Uri.parse('https://rdv.example:443'),
        ),
        isFalse,
      );
    });
  });
}
