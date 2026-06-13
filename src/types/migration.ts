/**
 * Types for server-to-server project migration (stage 1: DB rows).
 *
 * A migration moves a project from a SOURCE instance to a DESTINATION
 * instance over HTTPS. The source pushes; the destination receives. Stage 1
 * transfers the project's DB rows as a single JSON "DbBundle"; stage 2 adds
 * chunked file transfer (working tree, profile config dirs). The status
 * unions below already include the file-transfer states so the schema does
 * not need to change when stage 2 lands.
 */

/**
 * Lifecycle of a migration job on the SOURCE instance.
 *
 * pending → running → db_done → files_done → verifying → completed
 * with failed/aborted as terminal escapes. Stage 1 skips the file phase
 * (running → db_done → verifying → completed) but reserves `files_done`
 * for stage 2.
 */
export type MigrationJobStatus =
  | "pending"
  | "running"
  | "db_done"
  | "files_done"
  | "verifying"
  | "completed"
  | "failed"
  | "aborted";

/**
 * Lifecycle of an import on the DESTINATION instance.
 *
 * staged → importing (DB bundle applied) → receiving (file chunks) →
 * finalizing (assemble + extract; an ATOMIC claim so two concurrent
 * finalize calls cannot both run extraction) → completed, with failed as
 * the terminal escape. DB-only migrations skip `receiving` and go
 * importing → finalizing → completed.
 */
export type MigrationImportStatus =
  | "staged"
  | "receiving"
  | "importing"
  | "finalizing"
  | "completed"
  | "failed";

/**
 * How the project working tree travels in stage 2.
 * - full_tar: tar the whole working tree (minus EXCLUDE_PATTERNS).
 * - git_essentials: only .git + tracked-but-dirty files.
 * - none: DB rows only; the destination re-clones from GitHub.
 */
export type MigrationWorkingTreeMode = "full_tar" | "git_essentials" | "none";
