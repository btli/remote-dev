// @vitest-environment node
/**
 * Unit tests for the Crown judge (epic remote-dev-oyej.6): tolerant JSON parse
 * of {winner,reason}, deterministic fallback when no model is configured or the
 * model output is malformed. The endpoint resolver + fetch are injected.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));
// Default the endpoint resolver to "no model"; individual tests override.
vi.mock("../crown-judge-endpoint", () => ({
  resolveJudgeEndpoint: vi.fn(async () => null),
}));

import {
  judge,
  parseJudgeJson,
  fallbackJudge,
  type JudgeCandidate,
} from "../crown-judge";
import { resolveJudgeEndpoint } from "../crown-judge-endpoint";

const candidates: JudgeCandidate[] = [
  { id: "c1", branch: "crown/a", diff: "small" },
  { id: "c2", branch: "crown/b", diff: "a much larger diff body here ......" },
];

describe("parseJudgeJson", () => {
  it("parses a clean JSON object", () => {
    const r = parseJudgeJson(
      '{"winner":"c2","reason":"cleaner approach"}',
      candidates,
    );
    expect(r).toEqual({ winner: "c2", reason: "cleaner approach" });
  });

  it("extracts JSON embedded in prose / code fences", () => {
    const r = parseJudgeJson(
      'Sure!\n```json\n{"winner":"c1","reason":"simpler"}\n```',
      candidates,
    );
    expect(r.winner).toBe("c1");
  });

  it("falls back when the winner id is not a known candidate", () => {
    const r = parseJudgeJson('{"winner":"nope","reason":"x"}', candidates);
    // fallback picks the largest diff → c2
    expect(r.winner).toBe("c2");
  });

  it("falls back on completely malformed output", () => {
    const r = parseJudgeJson("not json at all", candidates);
    expect(r.winner).toBe("c2");
    expect(r.reason).toMatch(/fallback/i);
  });
});

describe("fallbackJudge", () => {
  it("picks the candidate with the largest diff", () => {
    expect(fallbackJudge(candidates).winner).toBe("c2");
  });
  it("handles a single candidate", () => {
    expect(fallbackJudge([candidates[0]]).winner).toBe("c1");
  });
});

describe("judge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the deterministic fallback when no model is configured", async () => {
    vi.mocked(resolveJudgeEndpoint).mockResolvedValueOnce(null);
    const r = await judge({ userId: "u1", prompt: "p", candidates });
    expect(r.winner).toBe("c2");
  });

  it("calls the resolved endpoint and parses its reply", async () => {
    vi.mocked(resolveJudgeEndpoint).mockResolvedValueOnce({
      baseUrl: "http://127.0.0.1:4000",
      apiKey: "sk-test",
      model: "claude-sonnet-4-5",
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          content: [{ type: "text", text: '{"winner":"c1","reason":"tighter"}' }],
        }),
    })) as unknown as typeof fetch;

    const r = await judge(
      { userId: "u1", prompt: "p", candidates },
      { fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(r).toEqual({ winner: "c1", reason: "tighter" });
  });

  it("falls back when the endpoint call throws", async () => {
    vi.mocked(resolveJudgeEndpoint).mockResolvedValueOnce({
      baseUrl: "http://127.0.0.1:4000",
      apiKey: "sk-test",
      model: "m",
    });
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const r = await judge(
      { userId: "u1", prompt: "p", candidates },
      { fetchImpl },
    );
    expect(r.winner).toBe("c2");
  });
});
