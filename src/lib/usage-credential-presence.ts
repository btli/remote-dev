/**
 * The single presence rule for encrypted Claude usage credentials. Empty or
 * missing ciphertext is absent everywhere: API views, reads, and poll sweeps.
 */
export function hasStoredUsageCredential(
  ciphertext: string | null | undefined
): ciphertext is string {
  return typeof ciphertext === "string" && ciphertext.length > 0;
}
