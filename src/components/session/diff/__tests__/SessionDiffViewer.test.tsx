/**
 * [n6uc.9] SessionDiffViewer truncation behavior: the viewer must never render
 * an unbounded DOM for very large diffs. It caps rendered lines (client-side)
 * and surfaces the server's "diff too large" flag.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import { SessionDiffViewer } from "../SessionDiffViewer";

/** Build a single-file unified diff with `n` added lines. */
function bigDiff(n: number): string {
  const header =
    "diff --git a/big.txt b/big.txt\n" +
    "new file mode 100644\n" +
    "index 000..111\n" +
    "--- /dev/null\n" +
    "+++ b/big.txt\n" +
    "@@ -0,0 +1," +
    n +
    " @@\n";
  const body = Array.from({ length: n }, (_, i) => `+line ${i}`).join("\n");
  return header + body + "\n";
}

function mockDiffResponse(payload: Record<string, unknown>) {
  apiFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(payload),
  } as unknown as Response);
}

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
});

describe("SessionDiffViewer truncation", () => {
  it("caps rendered diff lines and shows a client truncation notice", async () => {
    // 5000 lines > MAX_RENDERED_LINES (3000) → must be capped.
    mockDiffResponse({ raw: bigDiff(5000), base: "main", truncated: false });

    const { container } = render(<SessionDiffViewer sessionId="s1" />);

    await waitFor(() =>
      expect(screen.getByText(/Diff truncated/i)).toBeInTheDocument(),
    );
    // Notice reports shown-of-total.
    expect(screen.getByText(/3,000 of/)).toBeInTheDocument();
    // The notice points the reviewer at the terminal.
    expect(screen.getByText(/terminal/i)).toBeInTheDocument();

    // Crucially: far fewer line rows than the full 5000 (proves the cap holds).
    const rows = container.querySelectorAll("pre > div");
    expect(rows.length).toBeLessThanOrEqual(3000);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("does NOT show a truncation notice for a small diff", async () => {
    mockDiffResponse({ raw: bigDiff(10), base: "main", truncated: false });

    render(<SessionDiffViewer sessionId="s-small" />);

    await waitFor(() =>
      expect(screen.getByText(/1 file changed/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Diff truncated/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Diff too large/i)).not.toBeInTheDocument();
  });

  it("surfaces the server 'diff too large' flag from the route", async () => {
    mockDiffResponse({
      raw: bigDiff(20),
      base: "main",
      truncated: true,
      bytes: 12_000_000,
      limit: 10_485_760,
    });

    render(<SessionDiffViewer sessionId="s-server" />);

    await waitFor(() =>
      expect(screen.getByText(/Diff too large/i)).toBeInTheDocument(),
    );
  });
});
