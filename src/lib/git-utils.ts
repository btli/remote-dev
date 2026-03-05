/**
 * Pure git utility functions safe for client-side use.
 */

/**
 * Sanitize a string into a valid git branch name segment.
 */
export function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
