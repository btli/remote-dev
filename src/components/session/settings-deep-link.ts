/**
 * Deep-link patch helper for singleton Settings sessions.
 *
 * F5: seeding `typeMetadata.activeTab` only applies on session CREATE. When
 * the server reuses an existing Settings tab via scope-key dedup, the
 * requested section would otherwise be ignored. This helper decides whether
 * a follow-up `typeMetadataPatch: { activeTab }` update is needed, and is
 * unit-testable in isolation (unlike the SessionManager React component
 * where it was originally inlined).
 */
import type { TerminalSession } from "@/types/session";

/**
 * Returns `true` when the caller opened Settings with an explicit section
 * and the reused row's stored `activeTab` does NOT already match. In that
 * case, the caller should issue `updateSession({ typeMetadataPatch: {
 * activeTab: section } })`.
 */
export function shouldPatchSettingsTab(
  session: Pick<TerminalSession, "typeMetadata">,
  requestedSection: string | undefined
): boolean {
  if (!requestedSection) return false;
  const currentTab = (
    session.typeMetadata as { activeTab?: string } | null | undefined
  )?.activeTab;
  return currentTab !== requestedSection;
}
