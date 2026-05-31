import { describe, it, expect, vi, beforeEach } from "vitest";

// The route module imports @/db at top level; stub it so importing the route
// never initialises the real libsql client. We only test the auth gate here.
vi.mock("@/db", () => ({ db: {} }));

import { authorizeInternalRequest } from "@/app/api/internal/routes/route";

function reqWith(secretHeader?: string): Request {
  const headers = new Headers();
  if (secretHeader !== undefined) {
    headers.set("x-supervisor-internal-secret", secretHeader);
  }
  return new Request("https://sup.example.com/api/internal/routes", { headers });
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
function setNodeEnv(value: string | undefined): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

beforeEach(() => {
  delete process.env.SUPERVISOR_INTERNAL_SECRET;
  setNodeEnv(ORIGINAL_NODE_ENV);
});

describe("authorizeInternalRequest (I2)", () => {
  it("allows when the provided secret matches", () => {
    process.env.SUPERVISOR_INTERNAL_SECRET = "s3cret";
    expect(authorizeInternalRequest(reqWith("s3cret"))).toBeNull();
  });

  it("401 when a secret is set but the header is wrong/missing", async () => {
    process.env.SUPERVISOR_INTERNAL_SECRET = "s3cret";

    const wrong = authorizeInternalRequest(reqWith("nope"));
    expect(wrong?.status).toBe(401);
    expect((await wrong!.json()).code).toBe("UNAUTHORIZED");

    const missing = authorizeInternalRequest(reqWith());
    expect(missing?.status).toBe(401);
  });

  it("503 MISCONFIGURED in production when no secret is set", async () => {
    setNodeEnv("production");
    const res = authorizeInternalRequest(reqWith());
    expect(res?.status).toBe(503);
    expect((await res!.json()).code).toBe("MISCONFIGURED");
  });

  it("allows in dev when no secret is set (open endpoint)", () => {
    setNodeEnv("development");
    expect(authorizeInternalRequest(reqWith())).toBeNull();
  });
});
