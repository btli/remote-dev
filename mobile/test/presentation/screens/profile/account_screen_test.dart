import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/domain/account.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/infrastructure/api/account_api.dart';
import 'package:remote_dev/presentation/screens/profile/account_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show activeServerProvider;

class _MockAccountApi extends Mock implements AccountApi {}

ServerConfig _server() => ServerConfig(
      id: 'srv-1',
      label: 'My Server',
      url: 'https://rdv.example',
      lastUsedAt: DateTime.utc(2026, 1, 1),
    );

Widget _wrap({
  required AccountApi api,
  ServerConfig? server,
}) {
  return ProviderScope(
    overrides: [
      accountApiProvider.overrideWithValue(api),
      // Override the activeServer FutureProvider with a value that is already
      // resolved. Returning a SynchronousFuture means asyncServer.asData is
      // populated on the very first build, so tests don't have to pump twice
      // just to get past the implicit loading state.
      activeServerProvider.overrideWith(
        (ref) => SynchronousFuture<ServerConfig?>(server),
      ),
    ],
    child: const MaterialApp(home: AccountScreen()),
  );
}

void main() {
  late _MockAccountApi api;

  setUp(() {
    api = _MockAccountApi();
  });

  testWidgets('shows loading indicator while account is in flight',
      (tester) async {
    // Use a Completer so the future never completes during the test, locking
    // the screen in the loading state.
    final completer = Completer<Account>();
    when(() => api.me()).thenAnswer((_) => completer.future);

    await tester.pumpWidget(_wrap(api: api, server: _server()));
    // Let the activeServerProvider future resolve via microtasks. The account
    // FutureProvider stays pending, so the screen renders its loader.
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump();

    expect(find.byType(CupertinoActivityIndicator), findsOneWidget);
  });

  testWidgets('renders email on success', (tester) async {
    when(() => api.me()).thenAnswer(
      (_) async => const Account(
        email: 'jane@example.com',
        name: 'Jane Doe',
      ),
    );

    await tester.pumpWidget(_wrap(api: api, server: _server()));
    await tester.pumpAndSettle();

    expect(find.text('jane@example.com'), findsOneWidget);
    expect(find.text('Jane Doe'), findsOneWidget);
    expect(find.text('Sign out of this server'), findsOneWidget);
    expect(find.text('My Server'), findsOneWidget);
  });

  testWidgets('renders error message on failure', (tester) async {
    when(() => api.me()).thenThrow(StateError('No active session.'));

    await tester.pumpWidget(_wrap(api: api, server: _server()));
    await tester.pumpAndSettle();

    expect(find.text('Failed to load account'), findsOneWidget);
    expect(find.textContaining('No active session.'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('shows no-active-server view when server is null',
      (tester) async {
    when(() => api.me()).thenAnswer(
      (_) async => const Account(email: 'unused@example.com'),
    );

    await tester.pumpWidget(_wrap(api: api, server: null));
    await tester.pumpAndSettle();

    expect(find.text('No active server'), findsOneWidget);
    expect(find.text('Choose a server'), findsOneWidget);
    // The success body should not render in this branch.
    expect(find.text('unused@example.com'), findsNothing);
  });
}
