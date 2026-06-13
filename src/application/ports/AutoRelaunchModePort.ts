/**
 * AutoRelaunchModePort - Thin port for resolving the auto-relaunch mode.
 *
 * `RelaunchOnLimitUseCase` needs to know whether a limited session should be
 * left alone (`disabled`), notified (`notify`), or auto-relaunched (`auto`).
 * That decision layers a per-project override (from the inherited
 * `nodePreferences.claudeAutoRelaunchMode`) over a global default (from
 * `userSettings.claudeAutoRelaunchMode`).
 *
 * Resolving it touches the preference chain + user settings, so it is hidden
 * behind this port to keep the use-case unit-testable. The Wave C adapter
 * reads `getResolvedPreferences(userId, projectId).claudeAutoRelaunchMode`
 * (project override) and falls back to the user setting, then the `"notify"`
 * default.
 */

import type { ClaudeAutoRelaunchMode } from "@/types/claude-limits";

export interface AutoRelaunchModePort {
  /**
   * The effective auto-relaunch mode for a user + project (project override →
   * global default → "notify").
   */
  resolveMode(
    userId: string,
    projectId: string
  ): Promise<ClaudeAutoRelaunchMode>;
}
