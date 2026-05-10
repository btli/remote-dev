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

/** Bumped on any breaking change to the bridge surface. */
export const RDV_BRIDGE_VERSION = 1;

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
  /** Scroll terminal viewport to the bottom (session view only). */
  scrollToBottom: () => void;
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
    scrollToBottom: () => adapter.scrollToBottom(),
    back: () => adapter.back(),
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
      data: { state: "running" | "waiting" | "idle" | "error" };
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
