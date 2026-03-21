/**
 * Required GitHub OAuth scopes for full functionality.
 * Accounts missing any of these scopes will be flagged for re-authorization.
 */
export const REQUIRED_GITHUB_SCOPES = [
  "read:user",
  "user:email",
  "repo",
  "read:org",
] as const;

export const GITHUB_SCOPE_STRING = REQUIRED_GITHUB_SCOPES.join(" ");

/**
 * Check whether a stored scope string is missing any required scopes.
 * Returns true if the account should be re-authorized.
 */
export function isMissingRequiredScopes(storedScope: string | null): boolean {
  const granted = (storedScope ?? "").split(/[,\s]+/).filter(Boolean);
  return REQUIRED_GITHUB_SCOPES.some((s) => !granted.includes(s));
}
