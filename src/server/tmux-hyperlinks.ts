export interface TmuxVersion {
  major: number;
  minor: number;
}

interface TmuxWarningLogger {
  warn(message: string, context: Record<string, unknown>): void;
}

/** Parse the stable `tmux -V` output, including release suffixes such as 3.7b. */
export function parseTmuxVersion(output: unknown): TmuxVersion | null {
  if (typeof output !== "string") return null;
  const match = /^tmux\s+(\d+)\.(\d+)(?:[a-zA-Z][a-zA-Z0-9._-]*)?\s*$/.exec(output);
  if (!match) return null;

  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
  };
}

/** `-T hyperlinks` was added to tmux clients in 3.4. */
export function tmuxSupportsHyperlinks(version: TmuxVersion | null): boolean {
  return version !== null && (version.major > 3 || (version.major === 3 && version.minor >= 4));
}

/** Build top-level tmux argv so client features precede the attach command. */
export function buildTmuxAttachArgs(sessionName: string, supportsHyperlinks: boolean): string[] {
  const attachArgs = ["attach-session", "-t", sessionName];
  return supportsHyperlinks ? ["-T", "hyperlinks", ...attachArgs] : attachArgs;
}

/**
 * Resolves tmux's local feature support once for this terminal-server process.
 * A failed, malformed, or old version check must never prevent an attach.
 */
export class TmuxAttachArgumentResolver {
  private supportsHyperlinks: boolean | null = null;
  private resolved = false;

  constructor(
    private readonly readVersion: () => string | null,
    private readonly log: TmuxWarningLogger,
  ) {}

  forSession(sessionName: string): string[] {
    if (!this.resolved) this.resolveCapability();
    return buildTmuxAttachArgs(sessionName, this.supportsHyperlinks === true);
  }

  private resolveCapability(): void {
    this.resolved = true;
    let output: string | null = null;
    try {
      output = this.readVersion();
    } catch {
      // An unavailable tmux binary uses the same non-blocking fallback.
    }

    const version = parseTmuxVersion(output);
    this.supportsHyperlinks = tmuxSupportsHyperlinks(version);
    if (!this.supportsHyperlinks) {
      this.log.warn(
        "tmux 3.4+ is required to preserve OSC 8 hyperlinks; attaching without -T hyperlinks",
        {
          tmuxVersion: output?.trim() || null,
          requiredTmuxVersion: "3.4",
        },
      );
    }
  }
}
