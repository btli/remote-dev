# Mobile App APK Build Design

**Date:** 2026-02-23
**Goal:** Get the React Native mobile app to a fully functional, sideloadable APK state.

## Current State

The mobile app at `packages/mobile/` has complete UI screens and infrastructure code but is not buildable due to missing assets, stub API implementations, and build configuration gaps.

### What exists (code-complete)
- Auth: CF Access OAuth + API key login + biometric SecureStore
- Screens: Sessions list, Folders list, Settings, Login, Terminal session
- Infrastructure: WebSocket manager (auto-reconnect, network-aware), API client, push notifications
- UI: Tablet split layout, folder sidebar, terminal WebView with xterm.js
- Shared domain types package (`@remote-dev/domain`) - built

### What's broken / incomplete
1. Session & folder stores use stub implementations (TODO comments, mock data)
2. No asset files (icon, splash, adaptive icon referenced in app.json)
3. No eas.json for build configuration
4. Keyboard toolbar buttons (ESC/TAB/CTRL/arrows) have no handlers
5. New session FAB is a no-op
6. Path aliases (`@/*`, `@remote-dev/domain`) need babel module-resolver for runtime
7. Server URLs hardcoded to localhost

## Design

### Phase 1: Build Infrastructure
- Generate placeholder PNG assets (icon.png, splash-icon.png, adaptive-icon.png, notification-icon.png, favicon.png)
- Add `babel-plugin-module-resolver` for `@/*` and `@remote-dev/domain` path aliases
- Add `eas.json` with local build profile (APK output)
- Convert to `app.config.ts` or add env var support for `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_WS_URL`

### Phase 2: Wire Real API Calls
- `sessionStore.ts`: Replace stubs with `getApiClient()` calls for fetch/create/close/suspend/resume
- `folderStore.ts`: Replace stubs with `getApiClient()` calls for fetch/create/delete

### Phase 3: Fix Interactive Features
- Keyboard toolbar: Wire ESC/TAB/CTRL/arrows to `wsManager.sendInput()`
- New session: Simple Alert.prompt flow → `apiClient.createSession()`
- Settings: Add server URL configuration field with AsyncStorage persistence
- Session cards: Add swipe actions for suspend/close

### Phase 4: Build & Verify
- `npx expo prebuild --platform android`
- `npx expo run:android` for debug APK
- Test on device/emulator

## Auth Flow (Cloudflare Access)
Already implemented in code:
1. User taps "Login with Cloudflare Access"
2. Opens CF Access login page in system browser
3. CF redirects to `remotedev://auth-callback` with token
4. App exchanges CF token for API key via `/api/auth/mobile-exchange`
5. API key stored in SecureStore with optional biometric protection

## Connectivity
- `EXPO_PUBLIC_API_URL`: HTTP API base (e.g., `https://rdv.example.com`)
- `EXPO_PUBLIC_WS_URL`: WebSocket base (e.g., `wss://rdv.example.com/ws`)
- Configurable from Settings screen, persisted in AsyncStorage

## Build Method
Local Android SDK build via `npx expo run:android`.
