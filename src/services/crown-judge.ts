/**
 * CrownJudge — the LLM judge that picks a winner among Crown candidates (epic
 * remote-dev-oyej.6).
 *
 * The model call routes through the EXISTING model-key proxy via
 * {@link resolveJudgeEndpoint} (aehq cross-link). When no model is configured —
 * or the model output is unparseable — we fall back DETERMINISTICALLY (the
 * candidate with the largest non-trivial diff wins) so Crown NEVER hard-fails
 * on a missing key.
 */
import { createLogger } from "@/lib/logger";
import { resolveJudgeEndpoint } from "./crown-judge-endpoint";
import type { CrownJudgeResult } from "@/types/crown";

const log = createLogger("CrownJudge");

export interface JudgeCandidate {
  id: string;
  branch: string;
  diff: string;
}

export interface JudgeOptions {
  userId: string;
  prompt: string;
  candidates: JudgeCandidate[];
  model?: string;
}

/** Injectable seam for testing the model call without a real endpoint. */
export interface JudgeDeps {
  fetchImpl: typeof fetch;
}

/** Deterministic fallback: the candidate with the largest diff wins. */
export function fallbackJudge(candidates: JudgeCandidate[]): CrownJudgeResult {
  if (candidates.length === 0) {
    return { winner: "", reason: "no candidates (fallback)" };
  }
  let best = candidates[0];
  for (const c of candidates) {
    if ((c.diff?.length ?? 0) > (best.diff?.length ?? 0)) best = c;
  }
  return {
    winner: best.id,
    reason: "selected by deterministic fallback (largest diff)",
  };
}

/**
 * Tolerant parse of a judge model's reply into {winner,reason}. Accepts a bare
 * JSON object or one embedded in prose / code fences. Validates that `winner`
 * is a known candidate id; otherwise falls back deterministically.
 */
export function parseJudgeJson(
  raw: string,
  candidates: JudgeCandidate[],
): CrownJudgeResult {
  const ids = new Set(candidates.map((c) => c.id));
  // Find the first {...} block (greedy enough for a single object reply).
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]) as { winner?: unknown; reason?: unknown };
      const winner = typeof obj.winner === "string" ? obj.winner : "";
      const reason =
        typeof obj.reason === "string" ? obj.reason : "(no reason given)";
      if (ids.has(winner)) {
        return { winner, reason };
      }
    } catch {
      // fall through to deterministic fallback
    }
  }
  log.warn("judge output unparseable or unknown winner; using fallback");
  return fallbackJudge(candidates);
}

/** Extract the text content from an Anthropic /v1/messages response body. */
function extractMessageText(body: string): string {
  try {
    const json = JSON.parse(body) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    if (Array.isArray(json.content)) {
      return json.content
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("\n");
    }
  } catch {
    // not JSON — return as-is so parseJudgeJson can still try
  }
  return body;
}

function renderJudgePrompt(
  prompt: string,
  candidates: JudgeCandidate[],
): string {
  const blocks = candidates
    .map(
      (c) =>
        `### Candidate ${c.id} (branch ${c.branch})\n\`\`\`diff\n${c.diff || "(empty diff)"}\n\`\`\``,
    )
    .join("\n\n");
  return [
    `TASK:\n${prompt}`,
    "",
    "Below are candidate patches produced by different agents for the SAME task.",
    "Pick the single best one.",
    "",
    blocks,
  ].join("\n");
}

/**
 * Judge the candidates. Routes through the model-key proxy; deterministic
 * fallback on no-model / error / unparseable output.
 */
export async function judge(
  opts: JudgeOptions,
  deps: JudgeDeps = { fetchImpl: fetch },
): Promise<CrownJudgeResult> {
  const endpoint = await resolveJudgeEndpoint(opts.userId, opts.model);
  if (!endpoint) {
    log.info("no judge model configured; using deterministic fallback");
    return fallbackJudge(opts.candidates);
  }

  const system =
    'You are a senior engineer judging candidate patches for the SAME task. ' +
    'Reply ONLY as compact JSON {"winner":"<candidateId>","reason":"<one sentence>"}.';
  const user = renderJudgePrompt(opts.prompt, opts.candidates);

  try {
    const res = await deps.fetchImpl(`${endpoint.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": endpoint.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: endpoint.model,
        max_tokens: 512,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      log.warn("judge endpoint returned non-OK; using fallback", {
        status: res.status,
      });
      return fallbackJudge(opts.candidates);
    }
    const text = extractMessageText(await res.text());
    return parseJudgeJson(text, opts.candidates);
  } catch (err) {
    log.warn("judge endpoint call failed; using fallback", {
      error: String(err),
    });
    return fallbackJudge(opts.candidates);
  }
}
