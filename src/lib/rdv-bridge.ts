/**
 * rdv-bridge — JS surface for the native Flutter shell.
 *
 * The native WebView host calls these methods via `evaluateJavascript`
 * to drive the embedded surface (terminal, channel, recording). The
 * embedded surface exports an "adapter" — a set of callbacks pointing
 * at the actual terminal / view APIs — and `installRdvBridge` glues
 * them onto `window.rdvBridge`.
 *
 * Events going the other way (terminal-ready, selection-change, link-
 * open) call `notifyToNative()` which dispatches via
 * `window.flutter_inappwebview.callHandler` when present and is a no-op
 * otherwise — this lets the same routes render in a desktop browser
 * for testing.
 *
 * @see docs/superpowers/specs/2026-05-08-flutter-app-redesign-design.md §4
 */

/**
 * Bumped on any breaking change to the bridge surface.
 *
 * Versions:
 *   1 — initial surface (input/key/paste/setFontSize/setFontScale/
 *       setCursorBlink/scrollToBottom/back).
 *   2 — add `uploadImage(b64OrBytes, mimeType)` so the native shell can
 *       hand a gallery/camera-picked image to the embedded session view
 *       (remote-dev-1y9t), and `openSearch` / `closeSearch` for the
 *       in-terminal xterm.js SearchAddon overlay (remote-dev-mezp).
 *       Mobile has no Cmd+F, so the native shell's menu drives search
 *       through this bridge. Both methods are present on non-session
 *       embeds as no-op stubs.
 *   3 — extend the `onActivity` notify payload `state` union from the
 *       original 4 statuses (running/waiting/idle/error) to the full
 *       7-status `AgentActivityStatus` set, adding `compacting`, `ended`,
 *       and `subagent`; the session embed now actually emits `onActivity`
 *       (live agent activity → native status-bar pip) instead of leaving
 *       it permanently Idle (remote-dev-sguu).
 *   4 — add `refit()` (remote-dev-u5q5.2) so the native shell can force
 *       the embedded terminal to re-measure + re-fit its xterm.js grid on
 *       events that don't surface as page-level resize signals inside a
 *       platform WebView — app background→resume and Flutter route
 *       pop-back. Present on non-session embeds as a no-op stub. Older
 *       deployed PWA builds (pre-v4: v2/v3) lack the method, so the Dart
 *       side guards the call and silently no-ops.
 */
export const RDV_BRIDGE_VERSION = 4;

export interface RdvBridgeKeyMods {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

/**
 * Adapter contract — the embedded view's hooks into its underlying
 * controls. Every method must be safe to call multiple times and from
 * any frame after the view has mounted.
 */
export interface RdvBridgeAdapter {
  /** Write text to the terminal (session view only). */
  input: (text: string) => void;
  /** Send a named key with optional modifiers (session view only). */
  key: (name: string, mods: RdvBridgeKeyMods) => void;
  /** Paste from native clipboard into the terminal (session view only). */
  paste: (text: string) => void;
  /** Set terminal font size in px (session view only). */
  setFontSize: (px: number) => void;
  /**
   * Update the in-WebView font scale (0.85–1.30 in practice). Embeds
   * apply this by writing `--rdv-font-scale` on `<html>` so terminal
   * + channel content visually scales. Embeds that don't visually
   * use the variable may treat the call as a no-op.
   */
  setFontScale: (scale: number) => void;
  /**
   * Toggle the in-WebView terminal cursor blink. Only the session
   * embed mutates xterm.js's `cursorBlink` option; other embeds may
   * treat the call as a no-op.
   */
  setCursorBlink: (blink: boolean) => void;
  /** Scroll terminal viewport to the bottom (session view only). */
  scrollToBottom: () => void;
  /**
   * Force the embedded terminal to re-measure its container and re-fit the
   * xterm.js grid (session view only). Added in v4 (remote-dev-u5q5.2).
   *
   * Inside a platform WebView, app background→resume and Flutter route
   * pop-back (returning from Recordings / Settings stacked on the session
   * route) do NOT reliably emit page-level `resize` / `visibilitychange` /
   * `visualViewport` events, so the in-page resize pipeline never runs and
   * the grid goes stale until the user pinch-zooms. The native shell calls
   * `refit()` on those lifecycle edges to recompute cols/rows and push the
   * fresh size to the terminal server (another tmux client may also have
   * resized the session while this view was unfocused). Non-session embeds
   * treat the call as a no-op.
   */
  refit: () => void;
  /**
   * Open the in-terminal SearchAddon overlay (session view only).
   * Non-session embeds may treat the call as a no-op. Added in v2 of
   * the bridge so the native Flutter shell can wire a "Search" menu
   * action — mobile has no Cmd+F.
   */
  openSearch: () => void;
  /**
   * Close the in-terminal SearchAddon overlay (session view only).
   * Non-session embeds may treat the call as a no-op. Added in v2.
   */
  closeSearch: () => void;
  /**
   * Native back button pressed. Return `true` when the embed view
   * consumed the gesture (e.g. closed an open thread, dismissed a
   * modal, popped an in-WebView route) so the native shell knows NOT
   * to also pop its route. Return `false` when there's nothing to
   * handle and native should fall back to `Navigator.maybePop()`.
   *
   * Must remain synchronous: the Dart side awaits the JS return value
   * via `evaluateJavascript`, but a Promise return would let
   * `!!result` resolve to `true` *before* the JS settles, racing the
   * native pop. If async behavior is ever needed, widen this to
   * `boolean | Promise<boolean>` and update bridge_controller.dart's
   * eval source to await the result inside an async IIFE.
   */
  back: () => boolean;
  /**
   * Upload an image picked by the native shell (gallery or camera) into
   * the embedded session view. The data argument may be either a
   * base64-encoded string (preferred over the WebView boundary, since
   * `evaluateJavascript` only marshals JSON-safe primitives) or a raw
   * `Uint8Array` for in-process callers. `mimeType` should be one of
   * the JPEG/PNG/GIF/WEBP types accepted by `/api/images`.
   *
   * Implementations re-use the existing `sendImageToTerminal` helper so
   * the upload + path-paste behaves identically to the PWA's camera
   * button. Non-session embeds may treat the call as a no-op.
   *
   * Fire-and-forget by design — the bridge protocol marshals JSON-safe
   * primitives only, so success/failure is surfaced via the existing
   * onActivity / console paths rather than a return value.
   */
  uploadImage: (data: Uint8Array | string, mimeType: string) => void;
}

/**
 * Public shape of `window.rdvBridge`. Methods that an adapter doesn't
 * implement (e.g., a channel embed has no `input`) are still installed,
 * but the adapter's no-op stubs absorb the call.
 */
export interface RdvBridge extends RdvBridgeAdapter {
  readonly version: number;
}

/**
 * Install `window.rdvBridge` backed by `adapter`. Returns an uninstall
 * function that should be called on view unmount.
 */
export function installRdvBridge(adapter: RdvBridgeAdapter): () => void {
  const bridge: RdvBridge = {
    version: RDV_BRIDGE_VERSION,
    input: (text) => adapter.input(text),
    key: (name, mods) => adapter.key(name, mods),
    paste: (text) => adapter.paste(text),
    setFontSize: (px) => adapter.setFontSize(px),
    setFontScale: (scale) => adapter.setFontScale(scale),
    setCursorBlink: (blink) => adapter.setCursorBlink(blink),
    scrollToBottom: () => adapter.scrollToBottom(),
    refit: () => adapter.refit(),
    openSearch: () => adapter.openSearch(),
    closeSearch: () => adapter.closeSearch(),
    back: () => adapter.back(),
    uploadImage: (data, mimeType) => adapter.uploadImage(data, mimeType),
  };

  window.rdvBridge = bridge;

  return () => {
    if (window.rdvBridge === bridge) {
      delete window.rdvBridge;
    }
  };
}

/** Names of events the embedded view emits to native. */
export type NotifyName =
  | "onTerminalReady"
  | "onSelectionChange"
  | "onWantsPaste"
  | "onActivity"
  | "onLinkOpen";

/** Payload union — kept narrow on purpose; bump version to extend. */
export type NotifyPayload =
  | { name: "onTerminalReady"; data: Record<string, never> }
  | { name: "onSelectionChange"; data: { text: string } }
  | { name: "onWantsPaste"; data: Record<string, never> }
  | {
      name: "onActivity";
      data: {
        state:
          | "running"
          | "waiting"
          | "idle"
          | "error"
          | "compacting"
          | "ended"
          | "subagent";
      };
    }
  | { name: "onLinkOpen"; data: { url: string } };

/**
 * Send an event to the native shell. No-op when not running inside a
 * `flutter_inappwebview`-hosted WebView (so desktop browser rendering
 * during development still works).
 */
export async function notifyToNative<N extends NotifyName>(
  name: N,
  data: Extract<NotifyPayload, { name: N }>["data"]
): Promise<void> {
  const fip = window.flutter_inappwebview;
  if (!fip) return;
  await fip.callHandler(name, data);
}
