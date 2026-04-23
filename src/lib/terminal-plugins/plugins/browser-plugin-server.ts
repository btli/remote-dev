/**
 * BrowserPlugin (server half) — lifecycle for in-app headless browser
 * sessions. No tmux, no shell — the browser is driven server-side via
 * Playwright and streamed to the client as screenshots.
 *
 * @see ./browser-plugin-client.tsx for rendering.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
  BrowserSessionMetadata,
} from "@/types/terminal-type-server";
import type { TerminalSession } from "@/types/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("BrowserPlugin.Server");

/** Default browser server plugin instance */
export const BrowserServerPlugin: TerminalTypeServerPlugin = {
  type: "browser",
  priority: 80,
  builtIn: true,
  useTmux: false,

  createSession(): SessionConfig {
    const metadata: BrowserSessionMetadata = {
      currentUrl: null,
      viewportWidth: 1280,
      viewportHeight: 720,
      lastScreenshotAt: null,
    };

    return {
      shellCommand: null,
      shellArgs: [],
      environment: {},
      useTmux: false,
      metadata,
    };
  },

  onSessionExit(): ExitBehavior {
    return {
      showExitScreen: false,
      canRestart: false,
      autoClose: true,
    };
  },

  async onSessionClose(session: TerminalSession): Promise<void> {
    // Dynamic import to avoid loading playwright on client / in contexts
    // where the browser service isn't available.
    try {
      const BrowserService = await import("@/services/browser-service");
      await BrowserService.closeBrowserSession(session.id);
    } catch (error) {
      log.debug("BrowserService unavailable during session close", {
        sessionId: session.id,
        error: String(error),
      });
    }
  },

  canHandle(session: TerminalSession): boolean {
    return session.terminalType === "browser";
  },
};
