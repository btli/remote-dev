# Mobile App Architecture: Multi-Server Terminal Client

> **Mobile surface reconciliation.** Remote Dev has more than one mobile-ish
> surface; this document covers only the **Flutter** one:
>
> - **`mobile/`** — the **active Flutter app** (this document's subject).
> - **`packages/mobile/`** — an **Expo / React Native** app (separate codebase,
>   not covered here).
> - **`archive/mobile-flutter/`** — a **deprecated** earlier Flutter app, kept
>   for reference only; do not build on it.
> - **PWA** — there is no separate PWA project: the **web app itself** is
>   installable, via `public/manifest.json` + the service worker at
>   `src/app/sw.js/route.ts`, with mobile-web routes under `src/app/m/`. See
>   [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) → "Mobile & PWA".
>
> The rest of this document describes the **Flutter** architecture.

Technical architecture for the Remote Dev Flutter mobile app, migrating from a single-server model to multi-server support while preserving the existing clean architecture, Riverpod state management, and terminal integration patterns.

---

## 1. Package Structure

The existing four-layer clean architecture is preserved. New files are marked with `[NEW]`, modified files with `[MOD]`.

```
lib/
  main.dart                                    [MOD] -- add Isar init, remove singleton storage
  app.dart                                     [MOD] -- ShellRoute, multi-server router

  domain/
    entities/
      session.dart                             [KEEP]
      folder.dart                              [KEEP]
      notification.dart                        [KEEP]
      split_group.dart                         [KEEP]
      server_config.dart                       [NEW]  -- ServerConfig entity (id, url, port, nickname, auth)
    value_objects/
      session_status.dart                      [KEEP]
      terminal_type.dart                       [KEEP]
      agent_provider.dart                      [KEEP]
      connection_status.dart                   [KEEP]
      worktree_type.dart                       [KEEP]
      auth_method.dart                         [NEW]  -- sealed class: CfAccess | ApiKey | QrScanned
      server_id.dart                           [NEW]  -- strongly typed UUID wrapper
    errors/
      app_error.dart                           [KEEP]
    events/
      terminal_event.dart                      [KEEP]
    repositories/
      session_repository.dart                  [KEEP]
      folder_repository.dart                   [KEEP]
      notification_repository.dart             [KEEP]
      server_config_repository.dart            [NEW]  -- CRUD for server configs (local persistence)

  application/
    ports/
      terminal_gateway.dart                    [KEEP]
      auth_gateway.dart                        [MOD]  -- methods now accept serverId parameter
      appearance_gateway.dart                  [KEEP]
      folder_preferences_gateway.dart          [KEEP]
      git_gateway.dart                         [KEEP]
      qr_scanner_gateway.dart                  [NEW]  -- camera QR scanning abstraction
    use_cases/
      switch_server.dart                       [NEW]  -- orchestrates server switch (disconnect WS, swap client)
      scan_server_qr.dart                      [NEW]  -- parse QR payload, validate, create config

  infrastructure/
    api/
      remote_dev_client.dart                   [MOD]  -- takes baseUrl + apiKey as constructor args (no storage reads)
      remote_dev_client_factory.dart           [NEW]  -- creates RemoteDevClient from ServerConfig
      repositories/
        api_session_repository.dart            [KEEP]
        api_folder_repository.dart             [KEEP]
        api_notification_repository.dart       [KEEP]
      gateways/
        api_folder_preferences_gateway.dart    [KEEP]
        api_git_gateway.dart                   [KEEP]
    websocket/
      terminal_websocket_manager.dart          [KEEP]
      ws_message.dart                          [KEEP]
      connection_pool.dart                     [NEW]  -- manages multiple WebSocket connections across servers
    storage/
      secure_storage_service.dart              [MOD]  -- per-server credential keys (serverId prefix)
      server_config_store.dart                 [NEW]  -- Isar local DB for server configs
    push/
      push_notification_service.dart           [MOD]  -- register token per active server
    camera/
      qr_scanner_service.dart                  [NEW]  -- mobile_scanner implementation

  presentation/
    providers/
      providers.dart                           [MOD]  -- re-exports
      auth_providers.dart                      [MOD]  -- scoped to active server
      session_providers.dart                   [MOD]  -- scoped to active server
      terminal_providers.dart                  [MOD]  -- pool-aware
      folder_providers.dart                    [MOD]  -- scoped to active server
      appearance_providers.dart                [KEEP]
      git_providers.dart                       [MOD]  -- scoped to active server
      push_notification_providers.dart         [KEEP]
      server_config_providers.dart             [MOD]  -- REWRITE: server list, active server, CRUD
      notification_providers.dart              [NEW]  -- per-server notification state
    screens/
      auth/
        login_screen.dart                      [MOD]  -- server-aware (pre-fills from config)
      home/
        home_screen.dart                       [MOD]  -- edge drawer navigation
      session/
        terminal_screen.dart                   [MOD]  -- MobileInputBar, xterm disableStdin
        session_list_screen.dart               [KEEP]
      settings/
        settings_screen.dart                   [MOD]  -- server management section
        server_list_screen.dart                [NEW]  -- list/add/edit/delete servers
        server_detail_screen.dart              [NEW]  -- individual server config editor
      qr/
        qr_scan_screen.dart                    [NEW]  -- camera QR scanner
    widgets/
      common/
        adaptive_scaffold.dart                 [KEEP]
        glassmorphic_container.dart            [NEW]  -- BackdropFilter + blur + translucent fill
      sidebar/
        session_sidebar.dart                   [MOD]  -- server indicator at top
        folder_tree.dart                       [KEEP]
      session/
        create_session_sheet.dart              [KEEP]
      split/
        split_pane_layout.dart                 [KEEP]
      terminal/
        terminal_widget.dart                   [MOD]  -- disableStdin, MobileInputBar integration
        keyboard_toolbar.dart                  [KEEP]
        agent_exit_overlay.dart                [KEEP]
        mobile_input_bar.dart                  [NEW]  -- native TextField overlay for mobile input
      server/
        server_picker.dart                     [NEW]  -- dropdown or bottom sheet for server switching
        server_card.dart                       [NEW]  -- card widget for server list items
    theme/
      app_theme.dart                           [MOD]  -- glassmorphism surface overrides
      oklch.dart                               [KEEP]
      terminal_theme.dart                      [KEEP]
      color_schemes.dart                       [NEW]  -- all 12 OKLCH schemes from web app
    router/
      app_router.dart                          [NEW]  -- extracted GoRouter config with ShellRoute
```

---

## 2. Key Dependencies

Changes and additions to `pubspec.yaml`:

```yaml
environment:
  sdk: '>=3.7.0 <4.0.0'     # Dart 3.7 for latest sealed class + pattern matching
  flutter: '>=3.29.0'        # Flutter 3.29+ (stable as of March 2026)

dependencies:
  flutter:
    sdk: flutter

  # Terminal emulator
  xterm: ^4.0.0               # KEEP -- disableStdin mode for native input overlay

  # State management
  flutter_riverpod: ^2.6.1    # KEEP
  riverpod_annotation: ^2.6.1 # KEEP

  # Networking
  dio: ^5.7.0                 # KEEP
  web_socket_channel: ^3.0.1  # KEEP

  # Auth & secure storage
  flutter_secure_storage: ^9.2.2  # KEEP
  url_launcher: ^6.3.1            # KEEP
  app_links: ^6.3.3               # KEEP -- deep link handling

  # Navigation
  go_router: ^14.6.2          # KEEP

  # Local database (server configs, offline cache)
  isar: ^4.0.0-dev.14         # NEW -- embedded NoSQL for server configs + session cache
  isar_flutter_libs: ^4.0.0-dev.14

  # QR scanning
  mobile_scanner: ^6.0.2      # NEW -- camera-based QR code scanning

  # Serialization
  freezed_annotation: ^2.4.4  # KEEP
  json_annotation: ^4.9.0     # KEEP

  # Push notifications
  firebase_core: ^3.13.0      # KEEP
  firebase_messaging: ^15.2.5 # KEEP

  # Network awareness
  connectivity_plus: ^6.1.0   # KEEP

  # Local preferences
  shared_preferences: ^2.3.2  # KEEP

  # Haptics
  flutter_haptics: ^1.0.1     # NEW -- richer haptic patterns for key presses

  # Utilities
  collection: ^1.18.0         # KEEP
  equatable: ^2.0.5           # KEEP
  uuid: ^4.5.1                # NEW -- generate server config IDs client-side

dev_dependencies:
  flutter_test:
    sdk: flutter
  build_runner: ^2.4.13       # KEEP
  riverpod_generator: ^2.6.1  # KEEP
  freezed: ^2.5.7             # KEEP
  json_serializable: ^6.8.0   # KEEP
  flutter_lints: ^5.0.0       # BUMP
  mocktail: ^1.0.4            # KEEP
  isar_generator: ^4.0.0-dev.14  # NEW
```

**Dependency rationale:**

- **Isar over Hive/Drift**: Isar provides embedded NoSQL with zero-config, async queries, composite indexes, and automatic schema migration. Server configs are document-shaped (nested auth, optional fields), which fits NoSQL better than SQLite. Isar also provides offline session caching without defining a relational schema.
- **mobile_scanner over qr_code_scanner**: `mobile_scanner` uses CameraX (Android) and AVFoundation (iOS) directly. The older `qr_code_scanner` is archived. `mobile_scanner` supports barcode + QR, has better lifecycle handling, and is actively maintained.
- **flutter_inappwebview REMOVED**: The existing CF Access auth flow already uses `url_launcher` to open Chrome Custom Tabs / Safari, then receives credentials back via `app_links` deep link. InAppWebView was listed as a dependency but unused. Removing it saves approximately 2MB from the binary.

---

## 3. State Management: Multi-Server Riverpod Architecture

### 3.1 The Core Problem

The existing app has a single `ServerConfig` loaded from secure storage. Every provider depends on it:

```
serverConfigProvider (single) --> remoteDevClientProvider --> sessionRepositoryProvider
                                                         --> folderRepositoryProvider
                                                         --> terminalManagerProvider
```

Multi-server requires every server-scoped provider to rebuild when the active server changes, without losing state for background servers (WebSocket connections should survive server switches for notification delivery).

### 3.2 Server Config Entity

```dart
// domain/entities/server_config.dart

/// Persisted server configuration. Stored locally in Isar.
/// Each server has its own API key, sessions, and WebSocket connection.
class ServerConfig {
  final String id;           // UUID, generated client-side
  final String nickname;     // User-chosen display name ("Home Lab", "Office")
  final String serverUrl;    // https://dev.example.com
  final String terminalPort; // "6002" for local, ignored for remote
  final AuthMethod authMethod;
  final DateTime createdAt;
  final DateTime lastConnectedAt;
  final int sortOrder;

  // Derived
  String get wsUrl { /* same logic as existing ServerConfig.wsUrl */ }
  String get displayName => nickname.isNotEmpty ? nickname : Uri.parse(serverUrl).host;
}

/// How the user authenticated to this server.
sealed class AuthMethod {
  const AuthMethod();
}

final class CfAccessAuth extends AuthMethod {
  const CfAccessAuth();
  // Actual CF token + API key stored in flutter_secure_storage, keyed by serverId
}

final class ApiKeyAuth extends AuthMethod {
  const ApiKeyAuth();
  // API key stored in flutter_secure_storage, keyed by serverId
}

final class QrScannedAuth extends AuthMethod {
  const QrScannedAuth({required this.scannedAt});
  final DateTime scannedAt;
  // API key stored in flutter_secure_storage, keyed by serverId
}
```

### 3.3 Server Config Repository (Local)

```dart
// domain/repositories/server_config_repository.dart

abstract interface class ServerConfigRepository {
  /// All saved servers, ordered by sortOrder.
  Future<List<ServerConfig>> findAll();

  /// Find by ID. Returns null if not found.
  Future<ServerConfig?> findById(String id);

  /// Create or update a server config.
  Future<void> save(ServerConfig config);

  /// Delete a server config and its cached data.
  Future<void> delete(String id);

  /// Reorder servers.
  Future<void> reorder(List<String> orderedIds);

  /// Stream of config changes (for reactive UI updates).
  Stream<List<ServerConfig>> watchAll();
}
```

Implemented by `IsarServerConfigRepository` in the infrastructure layer. Server credentials (API key, CF token) remain in `flutter_secure_storage` with keys prefixed by server ID: `rdv_{serverId}_api_key`, `rdv_{serverId}_cf_token`, etc.

### 3.4 Provider Architecture

The key insight: introduce an `activeServerIdProvider` that all server-scoped providers watch. When the active server changes, all downstream providers rebuild automatically.

```dart
// presentation/providers/server_config_providers.dart

/// All saved server configurations (reactive stream from Isar).
final serverListProvider = StreamProvider<List<ServerConfig>>((ref) {
  final repo = ref.watch(serverConfigRepositoryProvider);
  return repo.watchAll();
});

/// Currently active server ID. Persisted in SharedPreferences.
final activeServerIdProvider = StateProvider<String?>((ref) {
  // Initialized from SharedPreferences in main.dart
  return null;
});

/// The active server's configuration. Null when no server selected.
final activeServerConfigProvider = Provider<ServerConfig?>((ref) {
  final serverId = ref.watch(activeServerIdProvider);
  if (serverId == null) return null;
  final servers = ref.watch(serverListProvider).valueOrNull ?? [];
  return servers.firstWhereOrNull((s) => s.id == serverId);
});

/// Secure storage scoped to the active server.
/// Returns a ServerScopedStorage that prefixes all keys with the server ID.
final serverScopedStorageProvider = Provider<ServerScopedStorage?>((ref) {
  final config = ref.watch(activeServerConfigProvider);
  if (config == null) return null;
  final storage = ref.watch(secureStorageProvider);
  return ServerScopedStorage(storage: storage, serverId: config.id);
});

/// HTTP client for the active server's REST API.
final remoteDevClientProvider = Provider<RemoteDevClient?>((ref) {
  final config = ref.watch(activeServerConfigProvider);
  final scopedStorage = ref.watch(serverScopedStorageProvider);
  if (config == null || scopedStorage == null) return null;

  return RemoteDevClient(
    storage: scopedStorage,
    baseUrl: config.serverUrl,
  );
});
```

**All existing providers (sessionListProvider, folderListProvider, etc.) continue to work unchanged** -- they already depend on `remoteDevClientProvider`. When the active server switches, `remoteDevClientProvider` rebuilds with a new client pointed at the new server, which cascades to all downstream providers.

### 3.5 Server-Scoped Secure Storage

```dart
// infrastructure/storage/secure_storage_service.dart (modified)

/// Wraps SecureStorageService to scope keys by server ID.
/// Prevents credential collision between servers.
class ServerScopedStorage {
  ServerScopedStorage({
    required SecureStorageService storage,
    required String serverId,
  }) : _storage = storage, _prefix = 'rdv_${serverId}_';

  final SecureStorageService _storage;
  final String _prefix;

  Future<String?> getApiKey() => _storage.read('${_prefix}api_key');
  Future<void> setApiKey(String value) => _storage.write('${_prefix}api_key', value);

  Future<String?> getCfToken() => _storage.read('${_prefix}cf_token');
  Future<void> setCfToken(String value) => _storage.write('${_prefix}cf_token', value);

  Future<String?> getUserId() => _storage.read('${_prefix}user_id');
  Future<void> setUserId(String value) => _storage.write('${_prefix}user_id', value);

  Future<String?> getUserEmail() => _storage.read('${_prefix}user_email');
  Future<void> setUserEmail(String value) => _storage.write('${_prefix}user_email', value);

  Future<void> clearAll() async {
    for (final suffix in ['api_key', 'cf_token', 'user_id', 'user_email']) {
      await _storage.delete('$_prefix$suffix');
    }
  }

  Future<bool> hasCredentials() async {
    final key = await getApiKey();
    return key != null;
  }
}
```

The base `SecureStorageService` gains generic `read(key)`, `write(key, value)`, `delete(key)` methods. The existing single-key methods become convenience wrappers for migration.

### 3.6 Background WebSocket Connections

When switching servers, the WebSocket to the previous server should NOT be killed -- notifications from agents on that server should still flow in. The `ConnectionPool` manages this:

```dart
// infrastructure/websocket/connection_pool.dart

/// Manages WebSocket connections across multiple servers.
/// The "active" connection gets full terminal I/O.
/// Background connections receive only broadcast events (notifications, agent status).
class ConnectionPool {
  final Map<String, TerminalWebSocketManager> _managers = {};
  String? _activeServerId;

  /// Get or create a manager for a specific server + session.
  TerminalWebSocketManager getManager({
    required String serverId,
    required String sessionId,
    required Future<String> Function() tokenFactory,
  }) {
    final key = '${serverId}:${sessionId}';
    return _managers.putIfAbsent(key, () {
      return TerminalWebSocketManager(tokenFactory: tokenFactory);
    });
  }

  /// Set which server is "active" (receives terminal I/O focus).
  void setActiveServer(String serverId) {
    _activeServerId = serverId;
  }

  /// Dispose a specific session's manager.
  void disposeSession(String serverId, String sessionId) {
    final key = '${serverId}:${sessionId}';
    _managers[key]?.dispose();
    _managers.remove(key);
  }

  /// Dispose all managers for a server (on server config deletion).
  void disposeServer(String serverId) {
    _managers.removeWhere((key, manager) {
      if (key.startsWith('$serverId:')) {
        manager.dispose();
        return true;
      }
      return false;
    });
  }

  void disposeAll() {
    for (final manager in _managers.values) {
      manager.dispose();
    }
    _managers.clear();
  }
}
```

### 3.7 Auth State Machine (Multi-Server)

The `AuthState` sealed class changes to track per-server auth:

```dart
// presentation/providers/auth_providers.dart

sealed class AuthState {
  const AuthState();
}

/// Checking credentials for the active server.
final class AuthLoading extends AuthState {
  const AuthLoading();
}

/// Authenticated to the active server.
final class Authenticated extends AuthState {
  const Authenticated({
    required this.serverId,
    required this.serverUrl,
    this.email,
  });
  final String serverId;
  final String serverUrl;
  final String? email;
}

/// No server selected, or active server has no credentials.
final class Unauthenticated extends AuthState {
  const Unauthenticated();
}

/// Multiple servers exist but none is active (show server picker).
final class ServerSelectionRequired extends AuthState {
  const ServerSelectionRequired({required this.serverCount});
  final int serverCount;
}
```

---

## 4. Navigation: GoRouter with Shell Routes and Edge Drawers

### 4.1 Route Structure

```dart
// presentation/router/app_router.dart

final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authNotifierProvider);
  final servers = ref.watch(serverListProvider).valueOrNull ?? [];

  return GoRouter(
    initialLocation: '/sessions',
    redirect: (context, state) {
      final path = state.matchedLocation;

      return switch (authState) {
        AuthLoading() => null,
        Unauthenticated() => path == '/login' ? null : '/login',
        ServerSelectionRequired() =>
          path == '/servers' || path == '/login' ? null : '/servers',
        Authenticated() =>
          path == '/login' || path == '/servers' ? '/sessions' : null,
      };
    },
    routes: [
      GoRoute(
        path: '/login',
        builder: (_, state) => LoginScreen(
          serverId: state.uri.queryParameters['serverId'],
        ),
      ),
      GoRoute(
        path: '/servers',
        builder: (_, __) => const ServerListScreen(),
      ),
      GoRoute(
        path: '/qr-scan',
        builder: (_, __) => const QrScanScreen(),
      ),

      // Shell route provides persistent edge drawers
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: '/sessions',
            builder: (_, __) => const HomeScreen(),
          ),
          GoRoute(
            path: '/sessions/:id',
            builder: (_, state) => TerminalScreen(
              sessionId: state.pathParameters['id']!,
            ),
          ),
          GoRoute(
            path: '/settings',
            builder: (_, __) => const SettingsScreen(),
          ),
          GoRoute(
            path: '/settings/servers',
            builder: (_, __) => const ServerListScreen(),
          ),
          GoRoute(
            path: '/settings/servers/:id',
            builder: (_, state) => ServerDetailScreen(
              serverId: state.pathParameters['id']!,
            ),
          ),
        ],
      ),
    ],
  );
});
```

### 4.2 AppShell with Edge Drawers

```dart
// The ShellRoute's builder wraps all authenticated screens with:
// - Left edge drawer: session list + folder tree (existing SessionSidebar)
// - Right edge drawer: quick actions (new session, server switcher, settings)
// - Both drawers activated by edge swipe gesture

class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sessions = ref.watch(filteredSessionsProvider);
    final activeSessionId = ref.watch(activeSessionIdProvider);
    final activeServer = ref.watch(activeServerConfigProvider);

    return Scaffold(
      // Left drawer: session list (swipe from left edge)
      drawer: Drawer(
        child: SessionSidebar(
          serverName: activeServer?.displayName,
          sessions: sessions,
          activeSessionId: activeSessionId,
          onSessionTap: (session) { /* navigate */ },
          onCreateSession: () { /* show sheet */ },
          onRefresh: () async { /* refresh */ },
        ),
      ),

      // Right drawer: quick actions (swipe from right edge)
      endDrawer: Drawer(
        child: QuickActionsDrawer(
          onNewSession: () { /* show create sheet */ },
          onSwitchServer: () { /* show server picker */ },
          onSettings: () { /* navigate to settings */ },
        ),
      ),

      body: child,
    );
  }
}
```

### 4.3 Deep Linking

Scheme: `remotedev://`

| Pattern | Purpose |
|---------|---------|
| `remotedev://auth/callback?apiKey=...&userId=...` | CF Access auth callback (existing) |
| `remotedev://server/{serverId}/session/{sessionId}` | Open specific session on specific server |
| `remotedev://server/add?url=...&port=...&key=...` | Add server from QR code or share link |

Android `AndroidManifest.xml` additions:
```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW"/>
    <category android:name="android.intent.category.DEFAULT"/>
    <category android:name="android.intent.category.BROWSABLE"/>
    <data android:scheme="remotedev" android:host="server"/>
</intent-filter>
```

iOS `Info.plist` additions:
```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLName</key>
        <string>com.remotedev.mobile</string>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>remotedev</string>
        </array>
    </dict>
</array>
```

---

## 5. Terminal Data Flow

### 5.1 Current Flow (Preserved)

```
WebSocket (server) --> WsServerMessage.fromJson() --> TerminalEvent (domain)
    |                                                      |
    v                                                      v
TerminalWebSocketManager                            TerminalWidget
    |                                                      |
    v                                                      v
events stream                                    xterm.Terminal.write(data)
                                                           |
                                                           v
                                                    xterm.TerminalView (render)
```

User input (current): `xterm.Terminal.onOutput --> gateway.sendInput(data)`

### 5.2 New Flow with disableStdin + MobileInputBar

The critical architectural change for mobile: xterm.dart's built-in keyboard handling is poor on mobile (no autocorrect, no voice dictation, no predictive text). The web app already solved this with `disableStdin` + a native `<textarea>` overlay. The Flutter app needs the equivalent.

```
                           TerminalScreen
                          /              \
              TerminalWidget            MobileInputBar
              (xterm view,              (native TextField,
               disableStdin=true)        autocorrect, voice)
                    |                         |
                    v                         v
              xterm.TerminalView        TextField.onSubmitted
              (display only)                  |
                    ^                         v
                    |                   gateway.sendInput(text + '\r')
                    |                         |
              gateway.events                  |
              (TerminalOutput)                |
                    ^                         |
                    |                         v
              TerminalWebSocketManager <------/
                    |
                    v
              WebSocket (server)
```

**MobileInputBar implementation:**

```dart
// presentation/widgets/terminal/mobile_input_bar.dart

class MobileInputBar extends StatefulWidget {
  const MobileInputBar({
    super.key,
    required this.onInput,
    this.onSpecialKey,
  });

  /// Called with the text the user typed + carriage return.
  final void Function(String data) onInput;

  /// Called for special key sequences (ctrl+c, arrows, etc).
  final void Function(String sequence)? onSpecialKey;

  @override
  State<MobileInputBar> createState() => _MobileInputBarState();
}

class _MobileInputBarState extends State<MobileInputBar> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();

  void _submit() {
    final text = _controller.text;
    if (text.isEmpty) {
      // Empty submit = just send carriage return (like pressing Enter)
      widget.onInput('\r');
    } else {
      // Send text followed by carriage return (NOT line feed)
      widget.onInput('$text\r');
      _controller.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Keyboard toolbar (ESC, CTRL, ALT, TAB, arrows)
        KeyboardToolbar(
          onKey: (sequence) => widget.onSpecialKey?.call(sequence),
        ),
        // Native text input
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: Theme.of(context).scaffoldBackgroundColor,
            border: Border(
              top: BorderSide(
                color: Theme.of(context).dividerColor.withValues(alpha: 0.2),
              ),
            ),
          ),
          child: SafeArea(
            top: false,
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    focusNode: _focusNode,
                    // Key mobile features:
                    autocorrect: true,
                    enableSuggestions: true,
                    enableIMEPersonalizedLearning: true,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _submit(),
                    decoration: const InputDecoration(
                      hintText: 'Type command...',
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.symmetric(horizontal: 12),
                      isDense: true,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.send),
                  onPressed: _submit,
                  iconSize: 20,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
```

**Critical note on carriage return**: Per the project memory (`terminal_carriage_return`), terminal input MUST use `\r` (carriage return) not `\n` (line feed) to submit commands. Claude Code's TUI specifically expects `\r` to initiate interaction. This is already handled correctly in the web app's `MobileInputBar.tsx`.

### 5.3 xterm.dart disableStdin Integration

```dart
// In TerminalWidget.build():

xterm.TerminalView(
  _terminal,
  theme: xtermTheme,
  textStyle: xterm.TerminalStyle(
    fontSize: widget.fontSize,
    fontFamily: widget.fontFamily,
  ),
  // Disable xterm's built-in keyboard handling on mobile.
  // Input is handled by MobileInputBar's native TextField instead.
  // This gives us autocorrect, voice dictation, and predictive text.
  readOnly: true,  // xterm.dart v4's equivalent of disableStdin
  autofocus: false, // Don't steal focus from MobileInputBar
),
```

---

## 6. Server Management

### 6.1 Server Lifecycle

```
User adds server
    |
    v
[Enter URL + port]  OR  [Scan QR code]  OR  [Receive deep link]
    |                        |                      |
    v                        v                      v
  Validate URL          Parse QR JSON          Parse URI params
    |                        |                      |
    +------------------------+----------------------+
    |
    v
Create ServerConfig (generate UUID)
    |
    v
Authenticate (CF Access browser flow OR direct API key)
    |
    v
Store credentials in flutter_secure_storage (keyed by serverId)
    |
    v
Save ServerConfig to Isar
    |
    v
Set as active server --> triggers cascade: remoteDevClientProvider rebuilds
                                           sessionListProvider refetches
                                           folderListProvider refetches
```

### 6.2 QR Code Payload Format

The server generates QR codes containing a JSON payload:

```json
{
  "v": 1,
  "url": "https://dev.example.com",
  "port": "6002",
  "key": "rdv_abc123...",
  "name": "Bryan's Mac Studio"
}
```

Scanning this creates a `ServerConfig` with `QrScannedAuth`, stores the API key, and auto-connects. No browser auth flow needed.

### 6.3 Server Switching

The `SwitchServer` use case orchestrates server switches without data loss:

```dart
// application/use_cases/switch_server.dart

class SwitchServer {
  SwitchServer({
    required ServerConfigRepository serverRepo,
    required SecureStorageService storage,
  });

  Future<Result<void>> execute(String targetServerId) async {
    // 1. Verify target server exists and has credentials
    final config = await serverRepo.findById(targetServerId);
    if (config == null) return Failure(NotFoundError('Server not found'));

    final scopedStorage = ServerScopedStorage(storage: storage, serverId: targetServerId);
    if (!await scopedStorage.hasCredentials()) {
      return Failure(AuthError('No credentials for this server'));
    }

    // 2. Update active server ID (triggers Riverpod cascade)
    // The actual switch happens in the provider layer
    return Success(null);
  }
}
```

In the provider layer, switching is just:

```dart
ref.read(activeServerIdProvider.notifier).state = targetServerId;
// Persist to SharedPreferences
prefs.setString('active_server_id', targetServerId);
```

This single line triggers:
- `activeServerConfigProvider` rebuilds with new config
- `serverScopedStorageProvider` rebuilds with new server's credentials
- `remoteDevClientProvider` rebuilds with new base URL + auth
- `sessionListProvider` rebuilds (refetches sessions from new server)
- `folderListProvider` rebuilds (refetches folders from new server)
- All terminal managers for the previous server's sessions are auto-disposed (via Riverpod's autoDispose)

### 6.4 Offline Session Cache

Each server's session list is cached in Isar for offline viewing:

```dart
// Stored per server in Isar
@collection
class CachedSession {
  Id id = Isar.autoIncrement;

  @Index()
  late String serverId;

  late String sessionId;
  late String name;
  late String status;
  late String terminalType;
  late String? agentProvider;
  late String? agentActivityStatus;
  late String? projectPath;
  late String? folderId;
  late DateTime lastActivityAt;
  late DateTime cachedAt;
}
```

The session list provider first shows cached data, then fetches fresh data:

```dart
// In SessionListNotifier.build():
final cached = await isarRepo.getCachedSessions(serverId);
state = AsyncValue.data(cached); // Show immediately

final result = await repo.findAll(); // Fetch fresh
if (result.isSuccess) {
  state = AsyncValue.data(result.valueOrThrow);
  await isarRepo.updateCache(serverId, result.valueOrThrow); // Update cache
}
```

---

## 7. Build Considerations

### 7.1 Android

**build.gradle:**

```groovy
android {
    namespace = "com.remotedev.mobile"
    compileSdk = 35  // Android 15

    defaultConfig {
        applicationId = "com.remotedev.mobile"
        minSdk = 26        // Android 8.0 (Oreo) -- covers 97%+ of devices
        targetSdk = 35     // Android 15
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            minifyEnabled = true
            shrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
}
```

**Permissions (AndroidManifest.xml):**

```xml
<!-- Existing -->
<uses-permission android:name="android.permission.INTERNET"/>

<!-- New: QR scanning -->
<uses-permission android:name="android.permission.CAMERA"/>
<uses-feature android:name="android.hardware.camera" android:required="false"/>
<uses-feature android:name="android.hardware.camera.autofocus" android:required="false"/>

<!-- New: Background WebSocket keepalive -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC"/>

<!-- New: Vibration for haptic feedback -->
<uses-permission android:name="android.permission.VIBRATE"/>
```

**ProGuard rules** (`proguard-rules.pro`):

```
# Isar
-keep class dev.isar.** { *; }

# WebSocket
-keep class io.flutter.plugins.** { *; }

# Firebase
-keep class com.google.firebase.** { *; }
```

### 7.2 iOS

**Info.plist additions:**

```xml
<!-- Camera for QR scanning -->
<key>NSCameraUsageDescription</key>
<string>Camera access is needed to scan server QR codes for quick setup.</string>

<!-- Deep link scheme -->
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleTypeRole</key>
        <string>Viewer</string>
        <key>CFBundleURLName</key>
        <string>com.remotedev.mobile</string>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>remotedev</string>
        </array>
    </dict>
</array>

<!-- Background modes for WebSocket keepalive -->
<key>UIBackgroundModes</key>
<array>
    <string>fetch</string>
    <string>remote-notification</string>
</array>

<!-- Prevent system keyboard suggestions from covering terminal -->
<key>UIStatusBarHidden</key>
<false/>
```

**Podfile:**

```ruby
platform :ios, '16.0'  # iOS 16 minimum (covers 95%+ of active devices)

post_install do |installer|
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.0'
    end
  end
end
```

**Capabilities (Xcode):**

- Associated Domains (for Universal Links, future): `applinks:*.remotedev.app`
- Push Notifications (APNS, existing via Firebase)
- Background Modes: Background fetch, Remote notifications
- Keychain Sharing (if needed for secure storage across app extensions)

### 7.3 App Size Budget

| Component | Estimated Size |
|-----------|---------------|
| Flutter engine | ~8 MB |
| Dart AOT code | ~4 MB |
| Nerd Fonts (3 families x 2 weights) | ~3 MB |
| Isar native library | ~2 MB |
| Firebase SDK | ~3 MB |
| Assets (icons, images) | ~0.5 MB |
| Other native plugins | ~1.5 MB |
| **Total (compressed)** | **~22 MB** |

Well under the 40 MB target. Adding all 22 Nerd Font families would push to ~35 MB. Strategy: ship 3 fonts (JetBrainsMono, FiraCode, MesloLGS), download additional fonts on-demand via the server's API.

### 7.4 Build Flavors

```yaml
# Defined via --dart-define or .env files

# Dev
flutter run --dart-define=ENV=dev --dart-define=DEFAULT_SERVER_URL=http://10.0.2.2:6001

# Staging
flutter run --dart-define=ENV=staging

# Production
flutter build apk --release --dart-define=ENV=production
flutter build ipa --release --dart-define=ENV=production
```

Firebase config files per flavor:
- `android/app/src/dev/google-services.json`
- `android/app/src/production/google-services.json`
- `ios/config/dev/GoogleService-Info.plist`
- `ios/config/production/GoogleService-Info.plist`

---

## 8. Design System Decisions

### 8.1 Glassmorphic Surfaces

The web app uses `backdrop-filter: blur()` extensively. The Flutter equivalent:

```dart
// presentation/widgets/common/glassmorphic_container.dart

class GlassmorphicContainer extends StatelessWidget {
  const GlassmorphicContainer({
    super.key,
    required this.child,
    this.blur = 12.0,
    this.opacity = 0.6,
    this.borderRadius = 16.0,
  });

  final Widget child;
  final double blur;
  final double opacity;
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ClipRRect(
      borderRadius: BorderRadius.circular(borderRadius),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
        child: Container(
          decoration: BoxDecoration(
            color: theme.colorScheme.surface.withValues(alpha: opacity),
            borderRadius: BorderRadius.circular(borderRadius),
            border: Border.all(
              color: theme.colorScheme.outline.withValues(alpha: 0.1),
            ),
          ),
          child: child,
        ),
      ),
    );
  }
}
```

**Performance note**: `BackdropFilter` triggers a saveLayer on the GPU. On phones, limit to 2-3 active BackdropFilters on screen simultaneously. Use solid surfaces for list items; reserve glassmorphism for modals, drawers, and overlay panels.

### 8.2 OKLCH Color Schemes

The web app defines 12 color schemes. The Flutter app ports them via the existing `oklchToColor()` conversion:

```dart
// presentation/theme/color_schemes.dart

enum ColorSchemeId {
  tokyoNight, midnight, ocean, arctic, forest,
  sunset, rose, amber, mono, dracula, nord, catppuccin;
}

/// Maps each scheme to its dark and light TerminalPalette.
/// Generated from the web app's src/lib/color-schemes.ts.
const Map<ColorSchemeId, (TerminalPalette dark, TerminalPalette light)> colorSchemes = {
  ColorSchemeId.tokyoNight: (TerminalPalette.defaultDark, /* light palette */),
  // ... remaining 11 schemes
};
```

### 8.3 Dynamic Color (Material You)

On Android 12+, the app can use the device's wallpaper-derived dynamic color scheme as the basis for the UI while keeping the terminal palette separate:

```dart
// In app.dart:
DynamicColorBuilder(
  builder: (ColorScheme? lightDynamic, ColorScheme? darkDynamic) {
    // Use dynamic colors for app chrome (toolbar, drawer, buttons)
    // Use terminal palette for terminal background and ANSI colors
    // This gives a native Android feel while maintaining terminal accuracy
  },
)
```

On iOS, the app uses the selected OKLCH scheme exclusively (iOS does not have Material You).

---

## 9. Migration Path from Single-Server

### Phase 1: Introduce ServerConfig Entity + Isar (Non-Breaking)

1. Add `server_config.dart` entity and `server_config_repository.dart` port
2. Add Isar dependency and `IsarServerConfigRepository`
3. On first launch, auto-migrate existing `SecureStorageService` credentials into a single `ServerConfig` with `id = "default"`
4. `activeServerIdProvider` defaults to `"default"`
5. All existing providers continue working -- the migration is transparent

### Phase 2: Multi-Server UI

1. Add `ServerListScreen`, `ServerDetailScreen`, `QrScanScreen`
2. Add server picker to the sidebar header
3. Modify `LoginScreen` to create a new `ServerConfig` on login
4. Add `ServerSelectionRequired` auth state

### Phase 3: MobileInputBar + disableStdin

1. Add `MobileInputBar` widget
2. Modify `TerminalWidget` to accept `readOnly` mode
3. Modify `TerminalScreen` to compose `TerminalWidget` + `MobileInputBar`
4. Keep `KeyboardToolbar` as a child of `MobileInputBar`

### Phase 4: Background Connections + Offline

1. Add `ConnectionPool` for multi-server WebSocket management
2. Add Isar session cache for offline viewing
3. Add background WebSocket keepalive service

---

## 10. Testing Strategy

### Unit Tests

| Layer | What to Test | Tool |
|-------|-------------|------|
| Domain | Entity immutability, value object parsing, Result type | `flutter_test` |
| Application | Use case orchestration (SwitchServer, ScanServerQr) | `mocktail` for ports |
| Infrastructure | JSON mapping in repositories/gateways | `flutter_test` |
| Presentation | Provider state transitions, auth state machine | `riverpod_test` |

### Integration Tests

| Scope | What to Test |
|-------|-------------|
| Isar | Server config CRUD, session cache, migration |
| Secure Storage | Per-server credential isolation |
| WebSocket | Connection, reconnection, background keepalive |
| Deep Links | URI parsing, navigation, server auto-add |

### E2E Tests (Patrol)

| Flow | Steps |
|------|-------|
| First launch | Add server -> Authenticate -> See sessions |
| Server switch | Add second server -> Switch -> Verify different sessions |
| QR scan | Open scanner -> Scan test QR -> Verify server added |
| Terminal | Open session -> Type command -> See output |
| Background | Switch to background -> Receive notification -> Tap to open session |

### Key Test Fixtures

```dart
// test/fixtures/server_configs.dart

final testServerA = ServerConfig(
  id: 'server-a',
  nickname: 'Home Lab',
  serverUrl: 'https://dev.home.local',
  terminalPort: '6002',
  authMethod: const ApiKeyAuth(),
  createdAt: DateTime(2026, 1, 1),
  lastConnectedAt: DateTime(2026, 3, 21),
  sortOrder: 0,
);

final testServerB = ServerConfig(
  id: 'server-b',
  nickname: 'Office',
  serverUrl: 'https://dev.office.example.com',
  terminalPort: '6002',
  authMethod: const CfAccessAuth(),
  createdAt: DateTime(2026, 2, 15),
  lastConnectedAt: DateTime(2026, 3, 20),
  sortOrder: 1,
);
```

---

## 11. Key Architecture Decisions Summary

| Decision | Rationale |
|----------|-----------|
| **Isar for local storage** | Server configs are document-shaped; schema-free is simpler than SQLite for this use case. Also provides session caching for offline mode. |
| **Server-scoped secure storage** | Key prefixing (`rdv_{id}_api_key`) is simpler than separate Keychain groups and works identically on iOS and Android. |
| **Riverpod cascade via activeServerIdProvider** | One state change triggers all downstream rebuilds automatically. No manual "refreshAll" needed. Existing providers require zero changes. |
| **ConnectionPool for background WS** | Notifications from non-active servers must still flow. Killing WebSockets on server switch would miss agent completion events. |
| **MobileInputBar over xterm stdin** | Native TextField gives autocorrect, voice dictation, and predictive text -- essential for mobile UX. The web app already validated this approach. |
| **CarriageReturn (\r) for submit** | Terminal expects \r not \n. Claude Code's TUI specifically requires \r to initiate interaction. Documented in project memory. |
| **ShellRoute for drawer persistence** | GoRouter ShellRoute keeps the AppShell (with drawers) mounted across route transitions. Without it, drawers would rebuild on every navigation. |
| **3 bundled fonts + on-demand download** | Keeps APK under 25 MB while supporting all 22 Nerd Font families via server download. |
| **flutter_inappwebview removed** | Unused dependency. CF Access auth uses url_launcher + app_links deep link, which is simpler and smaller. |
| **Phase 1 auto-migration** | Existing single-server users get a seamless upgrade. Their credentials become "server-default" in the new multi-server model. |
