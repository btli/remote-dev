# Mobile App APK Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Get the React Native mobile app (`packages/mobile/`) to a fully functional, sideloadable Android APK.

**Architecture:** Expo SDK 52 managed workflow app with Expo Router, Zustand stores, WebView terminal, and CF Access auth. Builds locally via `npx expo run:android`. The app connects to the Remote Dev backend over HTTPS/WSS.

**Tech Stack:** React Native 0.76, Expo SDK 52, Expo Router 4, Zustand 5, xterm.js (WebView), WebSocket, Cloudflare Access OAuth

---

### Task 1: Generate Placeholder Asset Files

The `app.json` references 5 image assets that don't exist. Without them, the build fails.

**Files:**
- Create: `packages/mobile/assets/icon.png` (1024x1024)
- Create: `packages/mobile/assets/splash-icon.png` (200x200)
- Create: `packages/mobile/assets/adaptive-icon.png` (1024x1024)
- Create: `packages/mobile/assets/notification-icon.png` (96x96)
- Create: `packages/mobile/assets/favicon.png` (48x48)

**Step 1: Generate assets with ImageMagick**

All icons use the Tokyo Night background (#1a1b26) with a blue terminal prompt icon (#7aa2f7).

```bash
cd /Users/bryanli/Projects/btli/remote-dev/packages/mobile/assets

# icon.png - 1024x1024 app icon
convert -size 1024x1024 xc:'#1a1b26' \
  -fill '#7aa2f7' -font Helvetica-Bold -pointsize 400 \
  -gravity center -annotate +0+0 '>_' \
  icon.png

# adaptive-icon.png - 1024x1024 Android adaptive icon (foreground)
convert -size 1024x1024 xc:none \
  -fill '#7aa2f7' -font Helvetica-Bold -pointsize 400 \
  -gravity center -annotate +0+0 '>_' \
  adaptive-icon.png

# splash-icon.png - 200x200 splash screen icon
convert -size 200x200 xc:'#1a1b26' \
  -fill '#7aa2f7' -font Helvetica-Bold -pointsize 80 \
  -gravity center -annotate +0+0 '>_' \
  splash-icon.png

# notification-icon.png - 96x96 (must be white on transparent for Android)
convert -size 96x96 xc:none \
  -fill white -font Helvetica-Bold -pointsize 40 \
  -gravity center -annotate +0+0 '>_' \
  notification-icon.png

# favicon.png - 48x48
convert -size 48x48 xc:'#1a1b26' \
  -fill '#7aa2f7' -font Helvetica-Bold -pointsize 20 \
  -gravity center -annotate +0+0 '>_' \
  favicon.png
```

**Step 2: Remove .gitkeep**

```bash
rm packages/mobile/assets/.gitkeep
```

**Step 3: Verify assets exist**

```bash
ls -la packages/mobile/assets/
```
Expected: 5 PNG files, no `.gitkeep`.

**Step 4: Commit**

```bash
git add packages/mobile/assets/
git commit -m "feat(mobile): add placeholder app icon assets"
```

---

### Task 2: Add Metro Config for Workspace Packages

Expo managed workflow needs Metro configured to resolve the `@remote-dev/domain` workspace package. Without this, Metro can't find files outside `packages/mobile/`.

**Files:**
- Create: `packages/mobile/metro.config.js`

**Step 1: Create Metro config**

```javascript
// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch the monorepo root for changes in workspace packages
config.watchFolders = [monorepoRoot];

// Resolve packages from both the mobile package and monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

module.exports = config;
```

**Step 2: Commit**

```bash
git add packages/mobile/metro.config.js
git commit -m "feat(mobile): add Metro config for monorepo workspace resolution"
```

---

### Task 3: Add Babel Module Resolver for Path Aliases

The codebase uses `@/*` imports (e.g., `@/infrastructure/api/RemoteDevApiClient`). TypeScript resolves these via `tsconfig.json` paths, but React Native needs babel to resolve them at runtime.

**Files:**
- Modify: `packages/mobile/package.json` (add dev dependency)
- Modify: `packages/mobile/babel.config.js` (add module-resolver plugin)

**Step 1: Install babel-plugin-module-resolver**

```bash
cd /Users/bryanli/Projects/btli/remote-dev/packages/mobile
bun add -d babel-plugin-module-resolver
```

**Step 2: Update babel.config.js**

Replace the entire file:

```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "module-resolver",
        {
          root: ["."],
          alias: {
            "@": "./src",
            "@remote-dev/domain": "../domain/src",
          },
          extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
        },
      ],
      "react-native-reanimated/plugin", // Must be last
    ],
  };
};
```

**Step 3: Verify TypeScript is happy**

```bash
cd /Users/bryanli/Projects/btli/remote-dev/packages/mobile
bunx tsc --noEmit 2>&1 | head -20
```

Expected: No errors (or only Expo-specific type warnings, not import resolution errors).

**Step 4: Commit**

```bash
git add packages/mobile/babel.config.js packages/mobile/package.json
git commit -m "feat(mobile): add babel module-resolver for path aliases"
```

---

### Task 4: Add EAS Build Configuration

Even for local builds, `eas.json` defines build profiles. We need a `preview` profile that outputs an APK (not AAB).

**Files:**
- Create: `packages/mobile/eas.json`

**Step 1: Create eas.json**

```json
{
  "cli": {
    "version": ">= 3.0.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "android": {
        "buildType": "apk"
      },
      "distribution": "internal"
    },
    "production": {
      "android": {
        "buildType": "app-bundle"
      }
    }
  }
}
```

**Step 2: Commit**

```bash
git add packages/mobile/eas.json
git commit -m "feat(mobile): add EAS build configuration with APK profile"
```

---

### Task 5: Add Server URL Configuration Store

The API client and WebSocket manager default to `localhost`. Users need to configure the server URL from Settings, persisted across app restarts.

**Files:**
- Create: `packages/mobile/src/application/state/stores/configStore.ts`
- Modify: `packages/mobile/src/infrastructure/api/RemoteDevApiClient.ts` (use config store URL)
- Modify: `packages/mobile/src/infrastructure/websocket/WebSocketManager.ts` (use config store URL)

**Step 1: Create configStore.ts**

```typescript
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface ConfigState {
  serverUrl: string;
  wsUrl: string;
}

interface ConfigActions {
  setServerUrl: (url: string) => void;
  setWsUrl: (url: string) => void;
  getEffectiveServerUrl: () => string;
  getEffectiveWsUrl: () => string;
}

type ConfigStore = ConfigState & ConfigActions;

/**
 * Persistent configuration store.
 * Stores server URLs that override environment defaults.
 */
export const useConfigStore = create<ConfigStore>()(
  persist(
    (set, get) => ({
      serverUrl: "",
      wsUrl: "",

      setServerUrl: (url) => set({ serverUrl: url.replace(/\/+$/, "") }),
      setWsUrl: (url) => set({ wsUrl: url.replace(/\/+$/, "") }),

      getEffectiveServerUrl: () => {
        const stored = get().serverUrl;
        if (stored) return stored;
        return process.env.EXPO_PUBLIC_API_URL || "http://localhost:6001";
      },

      getEffectiveWsUrl: () => {
        const stored = get().wsUrl;
        if (stored) return stored;
        // Derive from server URL if not explicitly set
        const serverUrl = get().getEffectiveServerUrl();
        const wsProtocol = serverUrl.startsWith("https") ? "wss" : "ws";
        const host = serverUrl.replace(/^https?:\/\//, "");
        return process.env.EXPO_PUBLIC_WS_URL || `${wsProtocol}://${host}`;
      },
    }),
    {
      name: "config-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
```

**Step 2: Update RemoteDevApiClient.ts getApiClient()**

In `packages/mobile/src/infrastructure/api/RemoteDevApiClient.ts`, replace the `getApiClient` function:

```typescript
export function getApiClient(): RemoteDevApiClient {
  if (!apiClient) {
    // Dynamic import would create circular dependency, so we use the env var default
    // The configStore will call initApiClient() when server URL changes
    apiClient = new RemoteDevApiClient({
      baseUrl: process.env.EXPO_PUBLIC_API_URL || "http://localhost:6001",
    });
  }
  return apiClient;
}

export function initApiClient(config: ApiConfig): RemoteDevApiClient {
  apiClient = new RemoteDevApiClient(config);
  return apiClient;
}

/**
 * Reinitialize the API client with a new base URL.
 * Called when server URL changes in config store.
 * Preserves existing API key.
 */
export function updateApiClientUrl(baseUrl: string): void {
  const existingKey = apiClient?.["config"]?.apiKey;
  apiClient = new RemoteDevApiClient({ baseUrl, apiKey: existingKey });
}
```

Note: The existing `initApiClient` function already exists. We just need to add `updateApiClientUrl`.

**Step 3: Update WebSocketManager.ts getWebSocketManager()**

In `packages/mobile/src/infrastructure/websocket/WebSocketManager.ts`, replace `getWebSocketManager`:

```typescript
export function getWebSocketManager(): WebSocketManager {
  if (!wsManager) {
    wsManager = new WebSocketManager({
      serverUrl: process.env.EXPO_PUBLIC_WS_URL || "ws://localhost:6001",
    });
    wsManager.startNetworkMonitoring();
  }
  return wsManager;
}

/**
 * Reinitialize the WebSocket manager with a new server URL.
 * Disconnects all existing connections.
 */
export function updateWebSocketUrl(serverUrl: string): void {
  if (wsManager) {
    wsManager.disconnectAll();
    wsManager.stopNetworkMonitoring();
  }
  wsManager = new WebSocketManager({ serverUrl });
  wsManager.startNetworkMonitoring();
}
```

Note: The `destroyWebSocketManager` function already exists and handles cleanup. We add `updateWebSocketUrl` alongside it.

**Step 4: Commit**

```bash
git add packages/mobile/src/application/state/stores/configStore.ts \
  packages/mobile/src/infrastructure/api/RemoteDevApiClient.ts \
  packages/mobile/src/infrastructure/websocket/WebSocketManager.ts
git commit -m "feat(mobile): add configurable server URL with persistence"
```

---

### Task 6: Wire Session Store to Real API

Replace all stub/mock implementations in `sessionStore.ts` with actual API client calls.

**Files:**
- Modify: `packages/mobile/src/application/state/stores/sessionStore.ts`

**Step 1: Replace stub implementations**

Replace `fetchSessions` (currently returns empty array):

```typescript
fetchSessions: async () => {
  set({ loading: true, error: null });
  try {
    const apiClient = getApiClient();
    const sessions = await apiClient.getSessions();
    set({ sessions, loading: false });
  } catch (error) {
    set({
      error: error instanceof Error ? error : new Error("Failed to fetch sessions"),
      loading: false,
    });
  }
},
```

Replace `createSession` (currently returns mock):

```typescript
createSession: async (input) => {
  set({ loading: true, error: null });
  try {
    const apiClient = getApiClient();
    const session = await apiClient.createSession({
      name: input.name,
      terminalType: input.terminalType as any,
    });
    get().addSession(session);
    set({ loading: false });
    return session;
  } catch (error) {
    set({
      error: error instanceof Error ? error : new Error("Failed to create session"),
      loading: false,
    });
    throw error;
  }
},
```

Replace `closeSession`:

```typescript
closeSession: async (id) => {
  try {
    const apiClient = getApiClient();
    await apiClient.closeSession(id);
    get().removeSession(id);
  } catch (error) {
    set({
      error: error instanceof Error ? error : new Error("Failed to close session"),
    });
    throw error;
  }
},
```

Replace `suspendSession`:

```typescript
suspendSession: async (id) => {
  try {
    const apiClient = getApiClient();
    const updated = await apiClient.suspendSession(id);
    get().updateSession(id, updated);
  } catch (error) {
    set({
      error: error instanceof Error ? error : new Error("Failed to suspend session"),
    });
    throw error;
  }
},
```

Replace `resumeSession`:

```typescript
resumeSession: async (id) => {
  try {
    const apiClient = getApiClient();
    const updated = await apiClient.resumeSession(id);
    get().updateSession(id, updated);
  } catch (error) {
    set({
      error: error instanceof Error ? error : new Error("Failed to resume session"),
    });
    throw error;
  }
},
```

Also add the import at the top of the file:

```typescript
import { getApiClient } from "@/infrastructure/api/RemoteDevApiClient";
```

**Step 2: Commit**

```bash
git add packages/mobile/src/application/state/stores/sessionStore.ts
git commit -m "feat(mobile): wire session store to real API client"
```

---

### Task 7: Wire Folder Store to Real API

Replace all stub/mock implementations in `folderStore.ts` with actual API client calls.

**Files:**
- Modify: `packages/mobile/src/application/state/stores/folderStore.ts`

**Step 1: Replace stub implementations**

Add import:

```typescript
import { getApiClient } from "@/infrastructure/api/RemoteDevApiClient";
```

Replace `fetchFolders`:

```typescript
fetchFolders: async () => {
  set({ loading: true, error: null });
  try {
    const apiClient = getApiClient();
    const folders = await apiClient.getFolders();
    set({ folders, loading: false });
  } catch (error) {
    set({
      error: error instanceof Error ? error : new Error("Failed to fetch folders"),
      loading: false,
    });
  }
},
```

Replace `createFolder`:

```typescript
createFolder: async (name, parentId) => {
  set({ loading: true, error: null });
  try {
    const apiClient = getApiClient();
    const folder = await apiClient.createFolder({ name, parentId });
    get().addFolder(folder);
    set({ loading: false });
    return folder;
  } catch (error) {
    set({
      error: error instanceof Error ? error : new Error("Failed to create folder"),
      loading: false,
    });
    throw error;
  }
},
```

Replace `deleteFolder`:

```typescript
deleteFolder: async (id) => {
  try {
    const apiClient = getApiClient();
    await apiClient.deleteFolder(id);
    get().removeFolder(id);
  } catch (error) {
    set({
      error: error instanceof Error ? error : new Error("Failed to delete folder"),
    });
    throw error;
  }
},
```

**Step 2: Commit**

```bash
git add packages/mobile/src/application/state/stores/folderStore.ts
git commit -m "feat(mobile): wire folder store to real API client"
```

---

### Task 8: Wire Keyboard Toolbar to WebSocket

The keyboard toolbar in `app/session/[id].tsx` renders ESC, TAB, CTRL, arrow keys but none of them send input. Wire them to the WebSocket manager.

**Files:**
- Modify: `packages/mobile/app/session/[id].tsx`

**Step 1: Add state for CTRL modifier**

Add a `ctrlActive` state and handlers. Replace the keyboard toolbar section (around line 150-166) with a functional version:

```tsx
// Add state near top of component:
const [ctrlActive, setCtrlActive] = useState(false);

// Helper to send special keys through WebSocket
const sendKey = useCallback((key: string) => {
  wsManagerRef.current.sendInput(id, key);
}, [id]);

const handleCtrlToggle = useCallback(() => {
  setCtrlActive((prev) => !prev);
}, []);

const handleKeyPress = useCallback((key: string) => {
  if (ctrlActive) {
    // Send Ctrl+key (ASCII control character)
    const charCode = key.toUpperCase().charCodeAt(0) - 64;
    if (charCode > 0 && charCode < 32) {
      sendKey(String.fromCharCode(charCode));
    }
    setCtrlActive(false);
  } else {
    sendKey(key);
  }
}, [ctrlActive, sendKey]);
```

Replace the keyboard toolbar JSX:

```tsx
{/* Mobile keyboard toolbar */}
<View style={styles.keyboardToolbar}>
  <TouchableOpacity style={styles.keyButton} onPress={() => sendKey("\x1b")}>
    <Text style={styles.keyText}>ESC</Text>
  </TouchableOpacity>
  <TouchableOpacity style={styles.keyButton} onPress={() => sendKey("\t")}>
    <Text style={styles.keyText}>TAB</Text>
  </TouchableOpacity>
  <TouchableOpacity
    style={[styles.keyButton, ctrlActive && styles.keyButtonActive]}
    onPress={handleCtrlToggle}
  >
    <Text style={[styles.keyText, ctrlActive && styles.keyTextActive]}>CTRL</Text>
  </TouchableOpacity>
  <TouchableOpacity style={styles.keyButton} onPress={() => sendKey("\x1b[A")}>
    <Ionicons name="arrow-up" size={18} color="#c0caf5" />
  </TouchableOpacity>
  <TouchableOpacity style={styles.keyButton} onPress={() => sendKey("\x1b[B")}>
    <Ionicons name="arrow-down" size={18} color="#c0caf5" />
  </TouchableOpacity>
</View>
```

Add styles for active CTRL state:

```typescript
keyButtonActive: {
  backgroundColor: "#7aa2f7",
},
keyTextActive: {
  color: "#1a1b26",
},
```

**Step 2: Commit**

```bash
git add packages/mobile/app/session/[id].tsx
git commit -m "feat(mobile): wire keyboard toolbar keys to WebSocket input"
```

---

### Task 9: Implement New Session Creation

The FAB button on the sessions screen currently just logs to console. Implement a simple session creation flow using Alert.prompt.

**Files:**
- Modify: `packages/mobile/app/(tabs)/index.tsx`

**Step 1: Replace handleNewSession**

Replace the `handleNewSession` function:

```tsx
const handleNewSession = useCallback(() => {
  Alert.prompt(
    "New Session",
    "Enter a name for the terminal session:",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Create",
        onPress: async (name?: string) => {
          if (!name?.trim()) return;
          try {
            const session = await createSession({ name: name.trim() });
            setActiveSession(session.id);
            router.push(`/session/${session.id}`);
          } catch (error) {
            Alert.alert(
              "Error",
              error instanceof Error ? error.message : "Failed to create session"
            );
          }
        },
      },
    ],
    "plain-text",
    "",
    "default"
  );
}, [createSession, setActiveSession, router]);
```

Update the destructured store values to include `createSession`:

```tsx
const { sessions, loading, error, fetchSessions, setActiveSession, createSession } = useSessionStore();
```

Add `Alert` to React Native imports:

```tsx
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert } from "react-native";
```

Add `useCallback` to React imports:

```tsx
import { useEffect, useState, useCallback } from "react";
```

Note: `Alert.prompt` is iOS-only. For Android, we need a fallback. Add a Platform check:

```tsx
import { ..., Platform } from "react-native";
```

Replace handleNewSession with cross-platform version:

```tsx
const handleNewSession = useCallback(() => {
  if (Platform.OS === "ios") {
    Alert.prompt(
      "New Session",
      "Enter a name for the terminal session:",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Create",
          onPress: async (name?: string) => {
            if (!name?.trim()) return;
            try {
              const session = await createSession({ name: name.trim() });
              setActiveSession(session.id);
              router.push(`/session/${session.id}`);
            } catch (error) {
              Alert.alert("Error", error instanceof Error ? error.message : "Failed to create session");
            }
          },
        },
      ],
      "plain-text"
    );
  } else {
    // Android: create with default name, user can rename later
    (async () => {
      try {
        const name = `Session ${sessions.length + 1}`;
        const session = await createSession({ name });
        setActiveSession(session.id);
        router.push(`/session/${session.id}`);
      } catch (error) {
        Alert.alert("Error", error instanceof Error ? error.message : "Failed to create session");
      }
    })();
  }
}, [createSession, setActiveSession, router, sessions.length]);
```

**Step 2: Commit**

```bash
git add packages/mobile/app/\(tabs\)/index.tsx
git commit -m "feat(mobile): implement new session creation from FAB button"
```

---

### Task 10: Add Server URL Settings

Add server URL configuration fields to the Settings screen so users can point the app at their Remote Dev server.

**Files:**
- Modify: `packages/mobile/app/(tabs)/settings.tsx`

**Step 1: Add server URL section**

Add import for the config store:

```tsx
import { useConfigStore } from "@/application/state/stores/configStore";
import { updateApiClientUrl } from "@/infrastructure/api/RemoteDevApiClient";
import { updateWebSocketUrl } from "@/infrastructure/websocket/WebSocketManager";
```

Add `TextInput` to RN imports:

```tsx
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, TextInput, Alert } from "react-native";
```

Add `useState` to React imports and config store usage inside the component:

```tsx
const { serverUrl, setServerUrl, getEffectiveServerUrl, getEffectiveWsUrl } = useConfigStore();
const [urlInput, setUrlInput] = useState(serverUrl);
```

Add a "Server" section after the Account section:

```tsx
{/* Server Section */}
<View style={styles.section}>
  <Text style={styles.sectionTitle}>Server</Text>
  <View style={styles.card}>
    <View style={styles.serverRow}>
      <View style={styles.rowLeft}>
        <Ionicons name="server" size={24} color="#7dcfff" />
        <Text style={styles.rowLabel}>Server URL</Text>
      </View>
    </View>
    <View style={styles.serverInputContainer}>
      <TextInput
        style={styles.serverInput}
        value={urlInput}
        onChangeText={setUrlInput}
        placeholder={getEffectiveServerUrl()}
        placeholderTextColor="#565f89"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
    </View>
    <TouchableOpacity
      style={styles.saveButton}
      onPress={() => {
        const url = urlInput.trim();
        setServerUrl(url);
        updateApiClientUrl(url || getEffectiveServerUrl());
        updateWebSocketUrl(getEffectiveWsUrl());
        Alert.alert("Saved", "Server URL updated. Restart sessions to reconnect.");
      }}
    >
      <Text style={styles.saveButtonText}>Save</Text>
    </TouchableOpacity>
  </View>
</View>
```

Add these styles:

```typescript
serverRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: 16,
  paddingTop: 16,
  paddingBottom: 8,
},
serverInputContainer: {
  paddingHorizontal: 16,
  paddingBottom: 8,
},
serverInput: {
  backgroundColor: "#1a1b26",
  borderRadius: 8,
  padding: 12,
  color: "#c0caf5",
  fontSize: 14,
  fontFamily: "monospace",
},
saveButton: {
  margin: 16,
  marginTop: 4,
  paddingVertical: 10,
  backgroundColor: "#7aa2f7",
  borderRadius: 8,
  alignItems: "center",
},
saveButtonText: {
  color: "#1a1b26",
  fontSize: 14,
  fontWeight: "600",
},
```

**Step 2: Commit**

```bash
git add packages/mobile/app/\(tabs\)/settings.tsx
git commit -m "feat(mobile): add server URL configuration in Settings"
```

---

### Task 11: Add Session Swipe Actions

Add swipe-to-suspend and long-press-to-close functionality on session cards.

**Files:**
- Modify: `packages/mobile/app/(tabs)/index.tsx`

**Step 1: Add swipe actions to session cards**

Import `Swipeable` from gesture handler:

```tsx
import { Swipeable } from "react-native-gesture-handler";
```

Add `suspendSession, closeSession` to the destructured store values:

```tsx
const { sessions, loading, error, fetchSessions, setActiveSession, createSession, suspendSession, closeSession } = useSessionStore();
```

Replace the `renderItem` in the FlatList with a swipeable version:

```tsx
renderItem={({ item }) => (
  <Swipeable
    renderRightActions={() => (
      <View style={styles.swipeActions}>
        {item.status === "active" && (
          <TouchableOpacity
            style={[styles.swipeAction, styles.suspendAction]}
            onPress={async () => {
              try {
                await suspendSession(item.id);
              } catch (e) {
                Alert.alert("Error", "Failed to suspend session");
              }
            }}
          >
            <Ionicons name="pause" size={20} color="#fff" />
            <Text style={styles.swipeActionText}>Suspend</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.swipeAction, styles.closeAction]}
          onPress={() => {
            Alert.alert("Close Session", `Close "${item.name}"?`, [
              { text: "Cancel", style: "cancel" },
              {
                text: "Close",
                style: "destructive",
                onPress: async () => {
                  try {
                    await closeSession(item.id);
                  } catch (e) {
                    Alert.alert("Error", "Failed to close session");
                  }
                },
              },
            ]);
          }}
        >
          <Ionicons name="close" size={20} color="#fff" />
          <Text style={styles.swipeActionText}>Close</Text>
        </TouchableOpacity>
      </View>
    )}
  >
    <TouchableOpacity
      style={styles.sessionCard}
      onPress={() => handleSessionPress(item.id)}
    >
      <View style={styles.sessionIcon}>
        <Ionicons
          name={item.terminalType === "agent" ? "sparkles" : "terminal"}
          size={24}
          color="#7aa2f7"
        />
      </View>
      <View style={styles.sessionInfo}>
        <Text style={styles.sessionName}>{item.name}</Text>
        <Text style={styles.sessionMeta}>
          {item.status} • {item.terminalType}
          {item.agentProvider && item.agentProvider !== "none"
            ? ` • ${item.agentProvider}`
            : ""}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#565f89" />
    </TouchableOpacity>
  </Swipeable>
)}
```

Add styles:

```typescript
swipeActions: {
  flexDirection: "row",
  alignItems: "center",
  marginVertical: 6,
  marginRight: 16,
},
swipeAction: {
  justifyContent: "center",
  alignItems: "center",
  width: 72,
  height: "100%",
  borderRadius: 12,
  marginLeft: 8,
},
swipeActionText: {
  color: "#fff",
  fontSize: 11,
  marginTop: 4,
  fontWeight: "500",
},
suspendAction: {
  backgroundColor: "#e0af68",
},
closeAction: {
  backgroundColor: "#f7768e",
},
```

**Step 2: Commit**

```bash
git add packages/mobile/app/\(tabs\)/index.tsx
git commit -m "feat(mobile): add swipe-to-suspend and swipe-to-close on session cards"
```

---

### Task 12: Install Dependencies and Prebuild Android

Install all dependencies and generate the native Android project.

**Files:**
- Modified: `packages/mobile/node_modules/` (bun install)
- Created: `packages/mobile/android/` (expo prebuild)

**Step 1: Install all dependencies**

```bash
cd /Users/bryanli/Projects/btli/remote-dev/packages/mobile
bun install
```

**Step 2: Clear Metro cache**

```bash
cd /Users/bryanli/Projects/btli/remote-dev/packages/mobile
bunx expo start --clear --no-dev 2>&1 | head -5
# Ctrl+C after it starts
```

Or simply:

```bash
rm -rf /Users/bryanli/Projects/btli/remote-dev/packages/mobile/.expo
```

**Step 3: Run expo prebuild for Android**

```bash
cd /Users/bryanli/Projects/btli/remote-dev/packages/mobile
bunx expo prebuild --platform android --clean
```

This generates the `android/` directory with Gradle build files.

**Step 4: Verify android directory was created**

```bash
ls packages/mobile/android/app/build.gradle
```

Expected: File exists.

**Step 5: Build the debug APK**

```bash
cd /Users/bryanli/Projects/btli/remote-dev/packages/mobile
bunx expo run:android --variant debug --no-install
```

The APK will be at `packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

**Step 6: Commit (excluding android/ as it's generated)**

Ensure `android/` is in `.gitignore`:

```bash
echo "android/" >> packages/mobile/.gitignore
echo "ios/" >> packages/mobile/.gitignore
git add packages/mobile/.gitignore
git commit -m "build(mobile): add android/ios to gitignore"
```

---

### Task 13: Final Integration Verification

Verify the complete flow works end-to-end.

**Step 1: Verify APK exists**

```bash
ls -lh packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

**Step 2: Verify APK can be installed on emulator (if available)**

```bash
adb install packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

**Step 3: Manual verification checklist**

- [ ] App launches to login screen
- [ ] API key login works (enter key from web Settings → API Keys)
- [ ] Sessions list loads from server
- [ ] Can create a new session
- [ ] Terminal WebView renders xterm.js
- [ ] Keyboard toolbar sends ESC/TAB/CTRL/arrows
- [ ] Can swipe to suspend/close sessions
- [ ] Settings shows server URL configuration
- [ ] Folders tab loads folders from server
- [ ] Pull-to-refresh works on sessions and folders

**Step 4: Final commit with all changes**

```bash
git add -A
git status
git commit -m "feat(mobile): complete mobile app for Android APK sideloading

Wire session/folder stores to real API, add keyboard toolbar input,
new session creation, server URL configuration, swipe actions,
placeholder assets, and build infrastructure."
```
