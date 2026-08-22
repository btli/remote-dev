import { existsSync } from "fs";

/**
 * Resolve a bun path for the LaunchAgent that SURVIVES `brew upgrade bun`.
 *
 * `process.execPath` resolves symlinks to the versioned Homebrew Cellar path
 * (e.g. `/opt/homebrew/Cellar/bun/1.4.0/bin/bun`), which the NEXT `brew upgrade`
 * deletes — leaving launchd unable to exec the wrapper (the 2026-08-21
 * dev.bryanli.net outage: prod stuck `spawn scheduled`, `kickstart` hung, no
 * logs, stale `exit 78`). When bun runs from a Cellar keg, prefer the
 * version-independent Homebrew symlink (`<prefix>/bin/bun` or
 * `<prefix>/opt/bun/bin/bun`), which `brew upgrade` repoints and never removes.
 * Non-Homebrew installs (e.g. `~/.bun/bin/bun`, replaced in place by
 * `bun upgrade`) are already stable and returned unchanged.
 *
 * `exists` is injectable for testing; it defaults to the real `existsSync`.
 */
export function resolveStableBunPath(
  execPath: string,
  exists: (p: string) => boolean = existsSync,
): string {
  const cellar = /^(.*)\/Cellar\/bun\/[^/]+\/bin\/bun$/.exec(execPath);
  if (!cellar) return execPath;
  const prefix = cellar[1];
  for (const candidate of [`${prefix}/bin/bun`, `${prefix}/opt/bun/bin/bun`]) {
    if (exists(candidate)) return candidate;
  }
  return execPath;
}
