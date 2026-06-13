// @vitest-environment node
/**
 * [remote-dev-yk42] Tests for `isTmuxSessionAuthorized` — the connect-time
 * ownership gate on the `?tmuxSession` WS query override.
 *
 * The session WS token is HMAC-bound to one { sessionId, userId }. The override
 * is format-validated elsewhere; this helper is the defense-in-depth check that
 * re-binds the requested tmux name to the token's USER, so a user cannot attach
 * to ANOTHER user's live tmux session by supplying a foreign `rdv-<uuid>`.
 *
 * Semantics are USER-level (not session-id-pinned):
 *   - no row (creation path) → ALLOW
 *   - row owned by same user (own + control-mode attach) → ALLOW
 *   - row owned by a different user (the attack) → REJECT
 */

import { describe, it, expect } from "vitest";
import { isTmuxSessionAuthorized } from "@/server/terminal";

const token = { sessionId: "sess-A", userId: "user-1" };

describe("isTmuxSessionAuthorized", () => {
  it("authorizes when the owning row belongs to the token's user (same session)", () => {
    expect(
      isTmuxSessionAuthorized({ id: "sess-A", userId: "user-1" }, token),
    ).toBe(true);
  });

  it("authorizes another of the SAME user's own sessions (control-mode attach)", () => {
    // User-level ownership: the token's user owns this row, even though it was
    // minted for a different sessionId. A control-mode token legitimately
    // attaches to another of the user's OWN sessions, so this must be allowed.
    expect(
      isTmuxSessionAuthorized({ id: "sess-B", userId: "user-1" }, token),
    ).toBe(true);
  });

  it("rejects when the row belongs to a different user (cross-user attach)", () => {
    // The actual remote-dev-yk42 attack: attaching to another user's live tmux
    // session. Must stay blocked regardless of the session id.
    expect(
      isTmuxSessionAuthorized({ id: "sess-A", userId: "user-2" }, token),
    ).toBe(false);
  });

  it("rejects when both user and session differ (cross-user attack)", () => {
    expect(
      isTmuxSessionAuthorized({ id: "sess-B", userId: "user-2" }, token),
    ).toBe(false);
  });

  it("authorizes when no row owns the requested tmux name (null = creation path)", () => {
    // No existing row means this connect CREATES the session (the terminal
    // server derives `rdv-${token.sessionId}` and makes the tmux session + DB
    // row here). There is nothing to hijack, and the derived name is bound to
    // the token's sessionId, so the brand-new-session path is allowed. This is
    // also the supervisor-router E2E smoke path (fresh randomUUID, no row).
    expect(isTmuxSessionAuthorized(null, token)).toBe(true);
  });

  it("authorizes when the lookup returned undefined (also the creation path)", () => {
    expect(isTmuxSessionAuthorized(undefined, token)).toBe(true);
  });
});
