import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/infrastructure/auth/pending_add_host_login.dart';
import 'package:remote_dev/presentation/screens/host_picker/add_host_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show pendingAddHostLoginStoreProvider, secureStorageProvider;

/// Map-backed [SecureStoragePort] mirroring the production key layout.
class _FakeStorage implements SecureStoragePort {
  final Map<String, String?> data = <String, String?>{};

  String _key(String ns, String key) => 'server.$ns.$key';

  @override
  Future<String?> read(String ns, String key) async => data[_key(ns, key)];

  @override
  Future<void> write(String ns, String key, String value) async {
    data[_key(ns, key)] = value;
  }

  @override
  Future<void> delete(String ns, String key) async {
    data.remove(_key(ns, key));
  }

  @override
  Future<void> deleteAll(String ns) async {
    data.removeWhere((k, _) => k.startsWith('server.$ns.'));
  }
}

void main() {
  Future<PendingAddHostLoginStore> pumpAddHost(
    WidgetTester tester, {
    required Future<bool> Function(Uri origin, String state) launchLogin,
    String Function()? stateGenerator,
  }) async {
    final storage = _FakeStorage();
    final store = PendingAddHostLoginStore(storage);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          secureStorageProvider.overrideWith((_) => throw UnimplementedError()),
          pendingAddHostLoginStoreProvider.overrideWithValue(store),
        ],
        child: MaterialApp(
          home: AddHostScreen(
            launchLogin: launchLogin,
            stateGenerator: stateGenerator,
          ),
        ),
      ),
    );
    return store;
  }

  Future<void> fillAndSubmit(
    WidgetTester tester, {
    String origin = 'https://dev.example.com',
    String label = 'Work',
  }) async {
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Host URL'),
      origin,
    );
    await tester.enterText(find.widgetWithText(TextFormField, 'Label'), label);
    await tester.tap(find.widgetWithText(ElevatedButton, 'Add'));
    // Do NOT pumpAndSettle: on success the waiting UI shows a
    // CircularProgressIndicator that never settles. Pump a few frames so the
    // async _submit (save + launch) resolves and the UI rebuilds.
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 10));
    }
  }

  testWidgets(
    'thin trigger: Add writes the pending record (origin/label/state) and '
    'launches the browser, then shows the waiting UI',
    (tester) async {
      Uri? launchedOrigin;
      String? launchedState;
      final store = await pumpAddHost(
        tester,
        stateGenerator: () => 'nonce-123',
        launchLogin: (origin, state) async {
          launchedOrigin = origin;
          launchedState = state;
          return true;
        },
      );

      await fillAndSubmit(tester);

      // Browser launched at the entered origin with the generated nonce.
      expect(launchedOrigin, Uri.parse('https://dev.example.com'));
      expect(launchedState, 'nonce-123');

      // Pending record persisted BEFORE the completer runs, carrying the nonce.
      final pending = await store.read();
      expect(pending, isNotNull);
      expect(pending!.origin, 'https://dev.example.com');
      expect(pending.label, 'Work');
      expect(pending.state, 'nonce-123');

      // The screen shows the waiting UI (completion happens globally).
      expect(find.text('Complete sign-in in your browser…'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Cancel'), findsOneWidget);
    },
  );

  testWidgets(
    'launch failure rolls back the pending record and surfaces an error',
    (tester) async {
      final store = await pumpAddHost(
        tester,
        launchLogin: (origin, state) async => false,
      );

      await fillAndSubmit(tester);

      // Pending record was cleared on launch failure.
      expect(await store.read(), isNull);
      expect(
        find.text('Could not open the browser to sign in. Please try again.'),
        findsOneWidget,
      );
      // Still on the form (not the waiting UI).
      expect(find.widgetWithText(ElevatedButton, 'Add'), findsOneWidget);
      expect(find.text('Complete sign-in in your browser…'), findsNothing);
    },
  );

  testWidgets(
    'Cancel from the waiting UI clears the pending record and returns to form',
    (tester) async {
      final store = await pumpAddHost(
        tester,
        launchLogin: (origin, state) async => true,
      );

      await fillAndSubmit(tester);
      expect(await store.read(), isNotNull);

      await tester.tap(find.widgetWithText(OutlinedButton, 'Cancel'));
      await tester.pumpAndSettle();

      // Pending cleared; back on the form.
      expect(await store.read(), isNull);
      expect(find.widgetWithText(ElevatedButton, 'Add'), findsOneWidget);
    },
  );

  testWidgets(
    'invalid URL fails form validation before writing a record or launching',
    (tester) async {
      var launchCalls = 0;
      final store = await pumpAddHost(
        tester,
        launchLogin: (origin, state) async {
          launchCalls += 1;
          return true;
        },
      );

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Host URL'),
        'not-a-url',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Label'),
        'Work',
      );
      await tester.tap(find.widgetWithText(ElevatedButton, 'Add'));
      await tester.pumpAndSettle();

      expect(
        find.text('Enter a valid URL with scheme and host'),
        findsOneWidget,
      );
      expect(launchCalls, 0);
      expect(await store.read(), isNull);
    },
  );
}
