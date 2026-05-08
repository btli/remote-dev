/**
 * Global type declarations for the Flutter ↔ PWA JS bridge.
 *
 * `window.rdvBridge` — installed by `installRdvBridge()` when an
 *   embedded mobile route mounts. The native shell calls into these
 *   methods via `evaluateJavascript`.
 *
 * `window.flutter_inappwebview` — present only when running inside a
 *   `flutter_inappwebview`-hosted WebView. The bridge calls
 *   `.callHandler(name, payload)` to send events to native.
 */

import type { RdvBridge } from "@/lib/rdv-bridge";

declare global {
  interface Window {
    rdvBridge?: RdvBridge;
    flutter_inappwebview?: {
      callHandler: (name: string, ...args: unknown[]) => Promise<unknown>;
    };
  }
}

export {};
