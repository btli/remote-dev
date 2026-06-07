// Widget tests for the Edit Host QR-scan / stored-token-load RACE
// (codex finding, remote-dev-8xfo).
//
// The bug: if the user scans a service-token QR before the async
// _loadServiceToken() read resolves, the late load could overwrite the freshly
// SCANNED Client ID with the OLD stored one, leaving the scanned secret paired
// with a stale id → a corrupted Save.
//
// Two layers of defense are verified here:
//   1. The "Scan QR" button is DISABLED until the load resolves (the primary
//      fix — mirrors the existing Clear-button gating), so in practice a scan
//      cannot begin before the stored token is known.
//   2. Belt-and-suspenders: once the fields have been scanned, a (late) load
//      MUST NOT clobber them. The end-to-end test releases a delayed load that
//      reports a DIFFERENT stored id, scans, and proves the SCANNED pair is what
//      gets saved.
//
// To exercise the timing deterministically the storage's service-token reads are
// gated on a Completer the test releases, and the camera scan is replaced with a
// `scanLauncher` test seam (no real camera plumbing).
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/qr_payload.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/infrastructure/storage/host_workspace_store_impl.dart';
import 'package:remote_dev/presentation/screens/server_picker/edit_host_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show
        hostWorkspaceStoreProvider,
        mobileCredentialsStoreProvider,
        secureStorageProvider;

/// Map-backed storage whose reads of the CF service-token keys BLOCK until the
/// test calls [releaseTokenRead]. Every other read/write resolves immediately so
/// the host/workspace store still works synchronously. Mirrors the production
/// `server.<ns>.<key>` layout.
class _DeferredTokenStorage implements SecureStoragePort {
  final Map<String, String?> data = <String, String?>{};
  final Completer<void> _gate = Completer<void>();

  static const _tokenKeys = <String>{
    'cfServiceClientId',
    'cfServiceClientSecret',
  };

  String _key(String ns, String key) => 'server.$ns.$key';

  /// Unblock the pending service-token reads.
  void releaseTokenRead() {
    if (!_gate.isCompleted) _gate.complete();
  }

  @override
  Future<String?> read(String ns, String key) async {
    if (_tokenKeys.contains(key)) {
      await _gate.future;
    }
    return data[_key(ns, key)];
  }

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

  final scanBtn = find.widgetWithText(OutlinedButton, 'Scan QR');
  final saveBtn = find.widgetWithText(ElevatedButton, 'Save');

  /// Pump EditHostScreen against [storage] with the host/workspace pre-seeded
  /// and a [scanLauncher] seam returning [scanResult] when "Scan QR" is tapped.
  Future<HostWorkspaceStoreImpl> pump(
    WidgetTester tester, {
    required _DeferredTokenStorage storage,
    required QrPayload? scanResult,
  }) async {
    final hostStore = HostWorkspaceStoreImpl(storage);
    await hostStore.upsertHost(host);
    await hostStore.upsertWorkspace(workspace);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          secureStorageProvider.overrideWith((_) => throw UnimplementedError()),
          hostWorkspaceStoreProvider.overrideWithValue(hostStore),
          mobileCredentialsStoreProvider
              .overrideWithValue(MobileCredentialsStore(storage)),
        ],
        child: MaterialApp(
          home: EditHostScreen(
            args: EditHostArgs(host: host, workspace: workspace),
            onSaved: () {},
            scanLauncher: (_) async => scanResult,
          ),
        ),
      ),
    );
    // A single pump (NOT pumpAndSettle) so the deferred token read is still
    // pending — the screen has built but _loadServiceToken hasn't resolved.
    await tester.pump();
    return hostStore;
  }

  testWidgets(
    'Scan QR is disabled until the stored-token load resolves',
    (tester) async {
      final storage = _DeferredTokenStorage();
      await pump(tester, storage: storage, scanResult: null);

      // Load still pending → button present but disabled.
      expect(scanBtn, findsOneWidget);
      expect(
        tester.widget<OutlinedButton>(scanBtn).onPressed,
        isNull,
        reason: 'Scan must be disabled while _loadServiceToken is in flight',
      );

      // Release the load → button enables.
      storage.releaseTokenRead();
      await tester.pumpAndSettle();
      expect(
        tester.widget<OutlinedButton>(scanBtn).onPressed,
        isNotNull,
        reason: 'Scan enables once the load resolves',
      );
    },
  );

  testWidgets(
    'a scanned token survives a stored-token load that reports a DIFFERENT id '
    '(no clobber) and Save persists the scanned pair',
    (tester) async {
      final storage = _DeferredTokenStorage();
      final creds = MobileCredentialsStore(storage);
      // A token IS stored, with an id that differs from what we will scan.
      await creds.setHostServiceToken(
        'h1',
        clientId: 'OLD-stored-id',
        clientSecret: 'old-stored-secret',
      );

      const scanned = CfServiceTokenPayload(
        host: 'https://dev.example.com',
        clientId: 'SCANNED-id',
        clientSecret: 'scanned-secret',
      );

      await pump(tester, storage: storage, scanResult: scanned);

      // Release the load so the stored id ('OLD-stored-id') is applied and the
      // Scan button enables.
      storage.releaseTokenRead();
      await tester.pumpAndSettle();
      expect(find.text('OLD-stored-id'), findsOneWidget);

      // Scan: the seam returns the scanned payload; the handler prefills the
      // fields and marks them dirty.
      await tester.tap(scanBtn);
      await tester.pumpAndSettle();

      // The Client ID field now shows the SCANNED id, not the stored one.
      expect(find.text('SCANNED-id'), findsOneWidget);
      expect(find.text('OLD-stored-id'), findsNothing);

      // Save persists the SCANNED pair — proving the scanned secret is paired
      // with the scanned id (never the stale stored id).
      await tester.tap(saveBtn);
      await tester.pumpAndSettle();

      final token = await creds.getHostServiceToken('h1');
      expect(token, isNotNull);
      expect(token!.clientId, 'SCANNED-id');
      expect(token.clientSecret, 'scanned-secret');
    },
  );
}
