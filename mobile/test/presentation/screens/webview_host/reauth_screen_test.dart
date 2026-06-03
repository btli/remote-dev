import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/application/state/active_connection.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/presentation/screens/webview_host/reauth_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show activeWorkspaceProvider, mobileCredentialsStoreProvider;

class _FakeStorage implements SecureStoragePort {
  final Map<String, String?> data = <String, String?>{};

  String _key(String serverId, String key) => 'server.$serverId.$key';

  @override
  Future<String?> read(String serverId, String key) async =>
      data[_key(serverId, key)];

  @override
  Future<void> write(String serverId, String key, String value) async {
    data[_key(serverId, key)] = value;
  }

  @override
  Future<void> delete(String serverId, String key) async {
    data.remove(_key(serverId, key));
  }

  @override
  Future<void> deleteAll(String serverId) async {
    data.removeWhere((k, _) => k.startsWith('server.$serverId.'));
  }
}

/// A migrated single-workspace connection: host owns the origin (no
/// trailing path), workspace has an empty basePath so `effectiveUrl ==
/// host.origin`.
ActiveConnection _conn({
  String hostId = 'h_srv-42',
  String workspaceId = 'w_srv-42',
  String origin = 'https://dev.example.com',
}) {
  final now = DateTime.utc(2026, 5, 1);
  return ActiveConnection(
    host: HostConfig(
      id: hostId,
      label: 'Work',
      origin: origin,
      kind: HostKind.singleWorkspace,
      createdAt: now,
      lastUsedAt: now,
    ),
    workspace: WorkspaceConfig(
      id: workspaceId,
      hostId: hostId,
      slug: '',
      basePath: '',
      displayName: 'Work',
      lastUsedAt: now,
    ),
  );
}

void main() {
  Future<void> pumpReauth(
    WidgetTester tester, {
    ActiveConnection? conn,
    _FakeStorage? storage,
    VoidCallback? onSuccess,
    VoidCallback? onCancel,
    MobileCallbackLauncherForReauth? launcherOverride,
  }) {
    final s = storage ?? _FakeStorage();
    return tester.pumpWidget(
      ProviderScope(
        overrides: [
          activeWorkspaceProvider.overrideWith((ref) async => conn),
          mobileCredentialsStoreProvider
              .overrideWithValue(MobileCredentialsStore(s)),
        ],
        child: MaterialApp(
          home: ReauthScreen(
            onSuccess: onSuccess ?? () {},
            onCancel: onCancel ?? () {},
            mobileCallbackLauncherOverride: launcherOverride,
          ),
        ),
      ),
    );
  }

  testWidgets(
    'renders no-active-server panel when there is no active connection',
    (tester) async {
      var cancelled = 0;
      await pumpReauth(
        tester,
        conn: null,
        onCancel: () => cancelled++,
      );
      await tester.pumpAndSettle();

      expect(find.text('No active server'), findsOneWidget);
      // Tapping the CTA invokes onCancel.
      await tester.tap(find.widgetWithText(ElevatedButton, 'Choose a server'));
      await tester.pump();
      expect(cancelled, 1);
    },
  );

  // Helper: pump a fixed number of frames to drive futures forward.
  // The screen renders a `CircularProgressIndicator` while the launcher
  // is in flight, so `pumpAndSettle` would never return — we drive
  // discrete frames instead.
  Future<void> drainFrames(WidgetTester tester) async {
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 16));
    }
  }

  testWidgets(
    'on callback success, persists host CF token + workspace API key and '
    'calls onSuccess',
    (tester) async {
      final storage = _FakeStorage();

      var successCount = 0;
      Uri? capturedUrl;
      await pumpReauth(
        tester,
        conn: _conn(hostId: 'h_srv-42', workspaceId: 'w_srv-42'),
        storage: storage,
        onSuccess: () => successCount++,
        launcherOverride: (serverUrl) async {
          capturedUrl = serverUrl;
          return const MobileCredentials(
            apiKey: 'sk-fresh',
            cfToken: 'fresh-jwt',
          );
        },
      );
      await drainFrames(tester);

      // Launch ran against the effective URL (== host origin for a migrated
      // single-workspace config).
      expect(capturedUrl, Uri.parse('https://dev.example.com'));
      // CF token landed on the HOST namespace; API key on the WORKSPACE
      // namespace (physical keys mirror `server.<ns>.<key>`).
      expect(storage.data['server.workspace.w_srv-42.apiKey'], 'sk-fresh');
      expect(storage.data['server.host.h_srv-42.cfToken'], 'fresh-jwt');
      expect(successCount, 1);
    },
  );

  testWidgets(
    'on callback cancel (null result), propagates to onCancel without writing',
    (tester) async {
      final storage = _FakeStorage();

      var cancelled = 0;
      await pumpReauth(
        tester,
        conn: _conn(),
        storage: storage,
        onCancel: () => cancelled++,
        launcherOverride: (_) async => null,
      );
      await drainFrames(tester);

      expect(cancelled, 1);
      expect(storage.data, isEmpty);
    },
  );
}
