import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/infrastructure/storage/host_workspace_store_impl.dart';
import 'package:remote_dev/presentation/screens/server_picker/edit_host_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show
        hostWorkspaceStoreProvider,
        mobileCredentialsStoreProvider,
        secureStorageProvider;

/// Map-backed [SecureStoragePort] mirroring the production key layout so the
/// real [HostWorkspaceStoreImpl] persists against an in-memory store (the D2
/// test convention — no platform channel, no mocked store).
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
  final host = HostConfig(
    id: 'h1',
    label: 'Work',
    origin: 'https://dev.example.com',
    kind: HostKind.singleWorkspace,
    createdAt: DateTime(2026, 5, 1),
    lastUsedAt: DateTime(2026, 5, 1),
  );

  final workspace = WorkspaceConfig(
    id: 'w1',
    hostId: 'h1',
    slug: '',
    basePath: '',
    displayName: 'Work',
    status: null,
    lastUsedAt: DateTime(2026, 5, 1),
  );

  /// Pump the screen against an in-memory store. Returns the shared
  /// [_FakeStorage] (so tests can seed/inspect service-token keys) alongside the
  /// host/workspace store. Both the [HostWorkspaceStoreImpl] and the screen's
  /// [MobileCredentialsStore] are backed by the SAME storage so writes the
  /// screen makes are visible to assertions.
  Future<({HostWorkspaceStoreImpl store, _FakeStorage storage})> pump(
    WidgetTester tester, {
    required EditHostArgs args,
    VoidCallback? onSaved,
    _FakeStorage? storage,
  }) async {
    final store = storage ?? _FakeStorage();
    final hostStore = HostWorkspaceStoreImpl(store);
    // Seed the host + workspace so upsert is a true update.
    await hostStore.upsertHost(host);
    await hostStore.upsertWorkspace(workspace);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          secureStorageProvider.overrideWith((_) => throw UnimplementedError()),
          hostWorkspaceStoreProvider.overrideWithValue(hostStore),
          mobileCredentialsStoreProvider
              .overrideWithValue(MobileCredentialsStore(store)),
        ],
        child: MaterialApp(
          home: EditHostScreen(args: args, onSaved: onSaved ?? () {}),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return (store: hostStore, storage: store);
  }

  testWidgets('pre-fills host label and workspace name', (tester) async {
    await pump(tester, args: EditHostArgs(host: host, workspace: workspace));

    // Both fields pre-filled with 'Work'.
    expect(find.widgetWithText(TextFormField, 'Host label'), findsOneWidget);
    expect(
      find.widgetWithText(TextFormField, 'Workspace name'),
      findsOneWidget,
    );
    expect(find.text('Work'), findsNWidgets(2));
    // Origin shown read-only.
    expect(find.text('https://dev.example.com'), findsOneWidget);
  });

  testWidgets(
    'save persists renamed host label + workspace display name, preserving ids',
    (tester) async {
      var savedCalled = false;
      final (:store, storage: _) = await pump(
        tester,
        args: EditHostArgs(host: host, workspace: workspace),
        onSaved: () => savedCalled = true,
      );

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Host label'),
        'Work (renamed)',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Workspace name'),
        'Primary',
      );
      await tester.tap(find.widgetWithText(ElevatedButton, 'Save'));
      await tester.pumpAndSettle();

      final hosts = await store.loadHosts();
      expect(hosts.single.id, 'h1');
      expect(hosts.single.label, 'Work (renamed)');
      expect(hosts.single.origin, 'https://dev.example.com');
      expect(hosts.single.lastUsedAt.isAfter(host.lastUsedAt), isTrue);

      final workspaces = await store.loadWorkspaces();
      expect(workspaces.single.id, 'w1');
      expect(workspaces.single.displayName, 'Primary');
      expect(workspaces.single.basePath, '');

      expect(savedCalled, isTrue);
    },
  );

  testWidgets(
    'host-only edit (no workspace) hides the workspace field',
    (tester) async {
      final (:store, storage: _) = await pump(
        tester,
        args: EditHostArgs(host: host),
      );

      expect(find.widgetWithText(TextFormField, 'Host label'), findsOneWidget);
      expect(
        find.widgetWithText(TextFormField, 'Workspace name'),
        findsNothing,
      );

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Host label'),
        'Renamed host',
      );
      await tester.tap(find.widgetWithText(ElevatedButton, 'Save'));
      await tester.pumpAndSettle();

      final hosts = await store.loadHosts();
      expect(hosts.single.label, 'Renamed host');
      // Workspace untouched.
      final workspaces = await store.loadWorkspaces();
      expect(workspaces.single.displayName, 'Work');
    },
  );

  testWidgets('empty host label keeps form open and does not persist',
      (tester) async {
    final (:store, storage: _) = await pump(
      tester,
      args: EditHostArgs(host: host, workspace: workspace),
    );

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Host label'),
      '',
    );
    await tester.tap(find.widgetWithText(ElevatedButton, 'Save'));
    await tester.pumpAndSettle();

    expect(find.text('Required'), findsOneWidget);
    // Label unchanged in the store.
    final hosts = await store.loadHosts();
    expect(hosts.single.label, 'Work');
  });

  // ---------------------------------------------------------------------------
  // CF Access service token — write-only secret + explicit Clear (findings 2+4)
  // ---------------------------------------------------------------------------
  group('CF Access service token', () {
    final secretField = find.widgetWithText(TextFormField, 'Client Secret');
    final idField = find.widgetWithText(TextFormField, 'Client ID');
    final saveBtn = find.widgetWithText(ElevatedButton, 'Save');

    testWidgets(
      'prefills only the Client ID, never the secret, and shows "Secret saved"',
      (tester) async {
        final storage = _FakeStorage();
        await MobileCredentialsStore(storage).setHostServiceToken(
          'h1',
          clientId: 'stored-id',
          clientSecret: 'stored-secret',
        );

        await pump(
          tester,
          args: EditHostArgs(host: host, workspace: workspace),
          storage: storage,
        );

        // Client ID prefilled; secret NEVER rendered.
        expect(find.text('stored-id'), findsOneWidget);
        expect(find.text('stored-secret'), findsNothing);
        // The write-only indicator is shown.
        expect(find.text('Secret saved'), findsOneWidget);
        // Clear button is present once a token exists.
        expect(
          find.widgetWithText(TextButton, 'Clear service token'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'Save with the secret left blank KEEPS the stored token (no destructive '
      'clear) — finding 2',
      (tester) async {
        final storage = _FakeStorage();
        final creds = MobileCredentialsStore(storage);
        await creds.setHostServiceToken(
          'h1',
          clientId: 'stored-id',
          clientSecret: 'stored-secret',
        );

        await pump(
          tester,
          args: EditHostArgs(host: host, workspace: workspace),
          storage: storage,
        );

        // Touch only the host label; leave the (blank) secret untouched.
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Host label'),
          'Renamed',
        );
        await tester.tap(saveBtn);
        await tester.pumpAndSettle();

        // The stored token must be intact.
        final token = await creds.getHostServiceToken('h1');
        expect(token, isNotNull);
        expect(token!.clientId, 'stored-id');
        expect(token.clientSecret, 'stored-secret');
      },
    );

    testWidgets('entering a new Client ID + Secret replaces the pair',
        (tester) async {
      final storage = _FakeStorage();
      final creds = MobileCredentialsStore(storage);
      await creds.setHostServiceToken(
        'h1',
        clientId: 'old-id',
        clientSecret: 'old-secret',
      );

      await pump(
        tester,
        args: EditHostArgs(host: host, workspace: workspace),
        storage: storage,
      );

      await tester.enterText(idField, 'new-id');
      await tester.enterText(secretField, 'new-secret');
      await tester.tap(saveBtn);
      await tester.pumpAndSettle();

      final token = await creds.getHostServiceToken('h1');
      expect(token!.clientId, 'new-id');
      expect(token.clientSecret, 'new-secret');
    });

    testWidgets('Clear service token button removes the stored pair',
        (tester) async {
      final storage = _FakeStorage();
      final creds = MobileCredentialsStore(storage);
      await creds.setHostServiceToken(
        'h1',
        clientId: 'stored-id',
        clientSecret: 'stored-secret',
      );

      await pump(
        tester,
        args: EditHostArgs(host: host, workspace: workspace),
        storage: storage,
      );

      await tester.tap(
        find.widgetWithText(TextButton, 'Clear service token'),
      );
      await tester.pumpAndSettle();

      // Token gone from storage; indicator + button gone from the UI.
      expect(await creds.getHostServiceToken('h1'), isNull);
      expect(find.text('Secret saved'), findsNothing);
      expect(
        find.widgetWithText(TextButton, 'Clear service token'),
        findsNothing,
      );
    });

    testWidgets(
      'a NEW token entry needs both halves: Client ID without Secret fails '
      'validation and does not persist',
      (tester) async {
        final storage = _FakeStorage();
        final creds = MobileCredentialsStore(storage);

        await pump(
          tester,
          args: EditHostArgs(host: host, workspace: workspace),
          storage: storage,
        );

        // No token stored, Clear button absent.
        expect(
          find.widgetWithText(TextButton, 'Clear service token'),
          findsNothing,
        );

        await tester.enterText(idField, 'only-id');
        await tester.tap(saveBtn);
        await tester.pumpAndSettle();

        expect(find.text('Enter the client secret too'), findsOneWidget);
        expect(await creds.getHostServiceToken('h1'), isNull);
      },
    );

    testWidgets(
      'with NO stored token, Save with both fields blank is a harmless no-op',
      (tester) async {
        final storage = _FakeStorage();
        final creds = MobileCredentialsStore(storage);

        var saved = false;
        await pump(
          tester,
          args: EditHostArgs(host: host, workspace: workspace),
          storage: storage,
          onSaved: () => saved = true,
        );

        await tester.tap(saveBtn);
        await tester.pumpAndSettle();

        expect(saved, isTrue);
        expect(await creds.getHostServiceToken('h1'), isNull);
      },
    );
  });
}
