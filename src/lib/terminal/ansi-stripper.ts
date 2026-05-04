/**
 * Stateful terminal escape sequence stripper.
 *
 * Handles sequences split across WebSocket chunks by buffering incomplete
 * escapes. Keeps SGR (colors/styles ending in 'm') for ansi-to-html.
 * Strips everything else: cursor movement, screen clearing, tmux status
 * bar rendering, character set selection, OSC, DCS, etc.
 *
 * Shared between {@link MobileTerminalView} (legacy) and the Phase 3
 * {@link MobileSessionView}. Behavior is intentionally identical across
 * both call sites — keep it that way.
 */
export class AnsiStripper {
  private pending = "";
  private static readonly MAX_PENDING = 64;

  reset(): void {
    this.pending = "";
  }

  process(data: string): string {
    let input = this.pending + data;
    this.pending = "";

    // Buffer incomplete escape sequence at end of chunk for next call.
    // Only buffer from the last \x1b if it's incomplete — complete
    // sequences before it are kept for regex processing below.
    const lastEsc = input.lastIndexOf("\x1b");
    if (lastEsc !== -1) {
      const tail = input.slice(lastEsc);
      const isComplete =
        /^\x1b\[[0-9;?]*[A-Za-z]/.test(tail) || // CSI (including SGR)
        /^\x1b\].*(?:\x07|\x1b\\)/.test(tail) || // OSC
        (/^\x1b[^[\]()]/.test(tail) && tail.length >= 2) || // Single-char
        /^\x1b[()]./.test(tail); // Character set

      if (!isComplete) {
        this.pending = tail.length <= AnsiStripper.MAX_PENDING ? tail : "";
        input = input.slice(0, lastEsc);
      }
    }

    return input
      // Remove CSI sequences that are NOT SGR (ending in a-l, n-z, A-Z except m)
      .replace(/\x1b\[[0-9;?]*[A-HJ-Za-lp-z]/g, "")
      // Remove OSC sequences: \x1b] ... (terminated by BEL or ST)
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      // Remove DCS/PM/APC sequences
      .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, "")
      // Remove character set selection: \x1b(B, \x1b)0, etc.
      .replace(/\x1b[()][A-Z0-9]/g, "")
      // Remove single-character escapes (\x1b=, \x1b>, \x1bM, etc.)
      .replace(/\x1b(?![\[(\])])[^\x1b]/g, "")
      // Remove \r not followed by \n (in-line overwrites from progress bars)
      .replace(/\r(?!\n)/g, "")
      // Remove stray lone \x1b that might remain
      .replace(/\x1b(?![\[(\]()])/g, "");
  }
}
