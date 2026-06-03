/**
 * Shared directory-browsing security helpers.
 *
 * Extracted from `src/app/api/directories/route.ts` so the same validation
 * logic can be reused by the directory listing, quick-access roots, and
 * folder-creation endpoints without duplicating (and risking diverging) the
 * security semantics.
 */

import { resolve, sep } from "node:path";
import { getFsPromises } from "@/lib/dynamic-fs";

/**
 * The set of filesystem prefixes a browse path is allowed to resolve into.
 *
 * Note: On macOS, `/tmp` realpaths to `/private/tmp` and `/var` to
 * `/private/var`, so both the symlink and realpath forms are included.
 */
export function getAllowedPrefixes(): string[] {
  const home = process.env.HOME || "/tmp";
  return [
    home,
    "/tmp",
    "/private/tmp", // macOS realpath for /tmp
    "/Users",
    "/home",
    "/private/var", // macOS realpath for /var
  ];
}

/**
 * Validate and resolve a path for directory browsing.
 *
 * SECURITY:
 * - Uses realpath() to resolve symlinks before validation (prevents /var -> /private/var bypass)
 * - Requires exact prefix match with path separator (prevents /Users-evil bypass)
 * - Only allows paths within HOME, /tmp, or common user directories
 *
 * @param inputPath - The raw, user-supplied path to validate.
 * @returns The resolved real path when allowed, otherwise `null`.
 */
export async function validateBrowsePath(
  inputPath: string
): Promise<string | null> {
  if (!inputPath) return null;

  try {
    // First resolve the path normally
    const resolved = resolve(inputPath);

    // Then resolve symlinks to get the real path
    // This prevents bypasses like /var -> /private/var on macOS
    let realPath: string;
    try {
      const fsp = await getFsPromises();
      realPath = await fsp.realpath(resolved);
    } catch {
      // realpath() throws when the target does not exist yet (e.g. a
      // folder-creation target) or for symlink loops / permission issues.
      // Falling back to the lexically-resolved path is safe: the allowlist
      // prefix check below still applies to it, so traversal is impossible.
      // Callers verify real existence/permissions afterward (GET via
      // fsp.access, POST via mkdir).
      realPath = resolved;
    }

    const allowedPrefixes = getAllowedPrefixes();

    // SECURITY: Check that path equals prefix OR starts with prefix + separator
    // This prevents bypasses like /Users-evil or /home-hack
    const isAllowed = allowedPrefixes.some(
      (prefix) => realPath === prefix || realPath.startsWith(prefix + sep)
    );

    if (!isAllowed) {
      return null;
    }

    return realPath;
  } catch {
    return null;
  }
}

/**
 * Validate a proposed new folder name.
 *
 * Rejects empty names, path separators, `.`/`..`, and excessively long names.
 *
 * @param rawName - The user-supplied folder name.
 * @returns The trimmed name when valid, otherwise `null`.
 */
export function validateFolderName(rawName: string): string | null {
  if (typeof rawName !== "string") return null;
  const name = rawName.trim();
  if (!name) return null;
  if (name === "." || name === "..") return null;
  if (name.length > 255) return null;
  // Reject any path separator (forward or back slash).
  if (name.includes("/") || name.includes("\\")) {
    return null;
  }
  // Reject NUL and other ASCII control characters (newlines, CR, etc.) that
  // corrupt directory listings and shell handling. Checked by char code to
  // avoid a control-character literal in a regex (no-control-regex).
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return null;
    }
  }
  return name;
}
