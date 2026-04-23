/**
 * BrowserPlugin (client half) — React rendering for in-app browser sessions.
 *
 * @see ./browser-plugin-server.ts for lifecycle.
 */

import { Globe } from "lucide-react";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
} from "@/types/terminal-type-client";
import { BrowserPane } from "@/components/terminal/BrowserPane";

/**
 * Browser session component. Delegates to the existing `BrowserPane`.
 */
function BrowserSessionComponent({ session }: TerminalTypeClientComponentProps) {
  return <BrowserPane session={session} />;
}

/** Default browser client plugin instance */
export const BrowserClientPlugin: TerminalTypeClientPlugin = {
  type: "browser",
  displayName: "Browser",
  description: "In-app headless browser pane with screenshot streaming",
  icon: Globe,
  priority: 80,
  builtIn: true,
  component: BrowserSessionComponent,
};
