/**
 * SettingsPlugin (client half) — React rendering for the Settings pane.
 *
 * Wraps the already-extracted `SettingsView` component (the panel
 * version of `UserSettingsModal` that lives outside the Dialog). When
 * A7 retires the `activeView === "settings"` branch in `SessionManager`,
 * Settings becomes a regular session with `terminalType === "settings"`
 * and this component renders directly in the main pane.
 *
 * Dismiss semantics (F2): the legacy modal mapped Escape / X to "close
 * the dialog". As a terminal tab that would instead delete the session
 * out from under the user — surprising UX. We pass a no-op `onClose` so
 * the only way to dismiss Settings is via the sidebar's tab-close
 * affordance. SettingsView still wires its own Escape handler, but it
 * calls the no-op and thus becomes inert.
 *
 * Active-tab persistence (F4): SettingsView now accepts an
 * `onSectionChange` callback. Each section change is persisted via
 * `updateSession({ typeMetadataPatch: { activeTab } })` so reopening the
 * tab after a reload lands on the previously-selected section. The
 * initial section is seeded from `session.typeMetadata.activeTab`.
 *
 * @see ./settings-plugin-server.ts for lifecycle.
 */

import { useCallback } from "react";
import { Settings } from "lucide-react";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
} from "@/types/terminal-type-client";
import type { TerminalSession } from "@/types/session";
import {
  SettingsView,
  type SettingsSection,
} from "@/components/settings/SettingsView";
import { useSessionContext } from "@/contexts/SessionContext";
import type { SettingsSessionMetadata } from "./settings-plugin-server";

const KNOWN_SECTIONS: SettingsSection[] = [
  "terminal",
  "appearance",
  "project",
  "agents",
  "proxy",
  "profiles",
  "secrets",
  "beads",
  "system",
  "logs",
  "mobile",
];

function parseInitialSection(
  metadata: TerminalSession["typeMetadata"]
): SettingsSection | undefined {
  const md = metadata as SettingsSessionMetadata | null | undefined;
  const tab = md?.activeTab;
  if (typeof tab !== "string") return undefined;
  return KNOWN_SECTIONS.includes(tab as SettingsSection)
    ? (tab as SettingsSection)
    : undefined;
}

/**
 * Settings session component.
 *
 * Wraps `SettingsView` in a flex container so it fills the available
 * pane height. SettingsView already manages its own internal scroll
 * regions, so we deliberately avoid adding a second scroll wrapper.
 */
function SettingsTabContent({
  session,
}: TerminalTypeClientComponentProps) {
  const { updateSession } = useSessionContext();
  const initialSection = parseInitialSection(session.typeMetadata);

  // F2: Intentional no-op. The legacy modal wired `onClose` to a Dialog
  // dismiss; as a terminal tab that would delete the session. Dismissal
  // now only happens via the tab-close affordance in the sidebar.
  const handleClose = useCallback(() => {
    // no-op
  }, []);

  // F4: Persist the active section back onto the session so reopening
  // Settings restores the user's previous tab. Fire-and-forget is fine
  // here — the server is the source of truth; a failed write just means
  // the next reload shows the default tab.
  const handleSectionChange = useCallback(
    (section: SettingsSection) => {
      void updateSession(session.id, {
        typeMetadataPatch: { activeTab: section },
      });
    },
    [session.id, updateSession]
  );

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <SettingsView
        initialSection={initialSection}
        onClose={handleClose}
        onSectionChange={handleSectionChange}
      />
    </div>
  );
}

/** Default settings client plugin instance */
export const SettingsClientPlugin: TerminalTypeClientPlugin = {
  type: "settings",
  displayName: "Settings",
  description: "Application settings",
  icon: Settings,
  priority: 60,
  builtIn: true,
  component: SettingsTabContent,
  deriveTitle: () => "Settings",
};
