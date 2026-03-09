/**
 * BrowserPlugin - In-app headless browser terminal type
 *
 * This plugin provides a headless Chromium browser pane with screenshot streaming.
 * No tmux session is needed - it uses Playwright to render pages and streams
 * screenshots to the client.
 *
 * Features:
 * - URL navigation with address bar
 * - Screenshot-based viewport rendering
 * - Click interaction mapped to viewport coordinates
 * - Back/forward navigation
 * - Accessibility tree snapshots for agent use
 */

import { Globe } from "lucide-react";
import type { ReactNode } from "react";
import type {
  TerminalTypePlugin,
  TerminalRenderProps,
  SessionConfig,
  ExitBehavior,
  BrowserSessionMetadata,
} from "@/types/terminal-type";
import type { TerminalSession, CreateSessionInput } from "@/types/session";

export const BrowserPlugin: TerminalTypePlugin = {
  type: "browser",
  displayName: "Browser",
  description: "In-app headless browser pane with screenshot streaming",
  icon: Globe,
  priority: 80,
  builtIn: true,

  createSession(
    _input: CreateSessionInput,
    _session: Partial<TerminalSession>
  ): SessionConfig {
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

  onSessionExit(
    _session: TerminalSession,
    _exitCode: number | null
  ): ExitBehavior {
    return {
      showExitScreen: false,
      canRestart: false,
      autoClose: true,
    };
  },

  async onSessionClose(session: TerminalSession): Promise<void> {
    // Dynamic import to avoid loading playwright on client
    try {
      const BrowserService = await import("@/services/browser-service");
      await BrowserService.closeBrowserSession(session.id);
    } catch {
      // Browser service not available (client-side) - ignore
    }
  },

  renderContent(
    session: TerminalSession,
    _props: TerminalRenderProps
  ): ReactNode {
    // Return a marker that the UI layer will interpret
    // The actual BrowserPane component is rendered by TerminalTypeRenderer
    return {
      type: "browser",
      session,
    } as unknown as ReactNode;
  },

  canHandle(session: TerminalSession): boolean {
    return session.terminalType === "browser";
  },
};
