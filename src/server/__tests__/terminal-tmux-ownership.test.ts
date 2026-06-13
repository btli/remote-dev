// @vitest-environment node
/**
 * [remote-dev-yk42] Tests for `isTmuxSessionAuthorized` — the connect-time
 * ownership gate on the `?tmuxSession` WS query override.
 *
 * The session WS token is HMAC-bound to one { sessionId, userId }. The override
 * is format-validated elsewhere; this helper is the defense-in-depth check that
 * re-binds the token to the DB session row that owns the requested tmux name,
 * so a user cannot attach to ANOTHER user's (or another of their own) tmux
 * session by supplying a foreign `rdv-<uuid>`.
 */

import { describe, it, expect } from "vitest";
import { isTmuxSessionAuthorized } from "@/server/terminal";

const token = { sessionId: "sess-A", userId: "user-1" };

describe("isTmuxSessionAuthorized", () => {
  it("authorizes when the owning row matches both userId and sessionId", () => {
    expect(
      isTmuxSessionAuthorized({ id: "sess-A", userId: "user-1" }, token),
    ).toBe(true);
  });

  it("rejects when the row belongs to a different user (cross-user attach)", () => {
    expect(
      isTmuxSessionAuthorized({ id: "sess-A", userId: "user-2" }, token),
    ).toBe(false);
  });

  it("rejects when the row is a different session of the same user", () => {
    // Same owner, but the token was not minted for this session.
    expect(
      isTmuxSessionAuthorized({ id: "sess-B", userId: "user-1" }, token),
    ).toBe(false);
  });

  it("rejects when both user and session differ", () => {
    expect(
      isTmuxSessionAuthorized({ id: "sess-B", userId: "user-2" }, token),
    ).toBe(false);
  });

  it("fails closed when no row owns the requested tmux name (null)", () => {
    expect(isTmuxSessionAuthorized(null, token)).toBe(false);
  });

  it("fails closed when the lookup returned undefined", () => {
    expect(isTmuxSessionAuthorized(undefined, token)).toBe(false);
  });
});
