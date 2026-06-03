import { describe, it, expect, beforeEach, vi } from "vitest";
import { SessionAdapterImpl } from "./SessionAdapterImpl";
import { Session } from "@/domain/entities/Session";
import type { SessionRepository } from "@/application/ports/SessionRepository";

/**
 * Build a Session in a given lifecycle state. `Session.create` yields an active
 * session whose tmuxSessionName is derived from the id; we then transition it
 * via the domain methods to reach suspended/closed/trashed states.
 */
function makeSession(
  id: string,
  name: string,
  projectId: string | null,
  state: "active" | "suspended" | "closed" | "trashed"
): Session {
  let session = Session.create({ id, userId: "user-1", name, projectId });
  if (state === "suspended") return session.suspend();
  if (state === "closed") return session.close();
  if (state === "trashed") {
    session = session.suspend();
    return session.trash();
  }
  return session;
}

describe("SessionAdapterImpl", () => {
  let repo: { findByUser: ReturnType<typeof vi.fn> };
  let adapter: SessionAdapterImpl;

  beforeEach(() => {
    repo = { findByUser: vi.fn() };
    adapter = new SessionAdapterImpl(
      repo as unknown as SessionRepository
    );
  });

  it("delegates to the repository with the userId", async () => {
    repo.findByUser.mockResolvedValue([]);

    await adapter.findByUser("user-1");

    expect(repo.findByUser).toHaveBeenCalledWith("user-1");
  });

  it("maps an active session and reports isActive: true", async () => {
    const session = makeSession(
      "11111111-1111-4111-8111-111111111111",
      "Dev",
      "proj-1",
      "active"
    );
    repo.findByUser.mockResolvedValue([session]);

    const result = await adapter.findByUser("user-1");

    expect(result).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Dev",
        projectId: "proj-1",
        tmuxSessionName: "rdv-11111111-1111-4111-8111-111111111111",
        isActive: true,
      },
    ]);
  });

  it("includes suspended sessions (tmux survives suspension) with isActive: true", async () => {
    const suspended = makeSession(
      "22222222-2222-4222-8222-222222222222",
      "Suspended",
      null,
      "suspended"
    );
    repo.findByUser.mockResolvedValue([suspended]);

    const result = await adapter.findByUser("user-1");

    expect(result).toEqual([
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Suspended",
        projectId: null,
        tmuxSessionName: "rdv-22222222-2222-4222-8222-222222222222",
        isActive: true,
      },
    ]);
  });

  it("filters out closed and trashed sessions", async () => {
    const active = makeSession(
      "33333333-3333-4333-8333-333333333333",
      "Active",
      "proj-1",
      "active"
    );
    const suspended = makeSession(
      "44444444-4444-4444-8444-444444444444",
      "Suspended",
      "proj-2",
      "suspended"
    );
    const closed = makeSession(
      "55555555-5555-4555-8555-555555555555",
      "Closed",
      "proj-3",
      "closed"
    );
    const trashed = makeSession(
      "66666666-6666-4666-8666-666666666666",
      "Trashed",
      "proj-4",
      "trashed"
    );
    repo.findByUser.mockResolvedValue([active, suspended, closed, trashed]);

    const result = await adapter.findByUser("user-1");

    expect(result.map((s) => s.id)).toEqual([
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ]);
  });

  it("returns an empty array when the user has no sessions", async () => {
    repo.findByUser.mockResolvedValue([]);

    const result = await adapter.findByUser("user-1");

    expect(result).toEqual([]);
  });
});
