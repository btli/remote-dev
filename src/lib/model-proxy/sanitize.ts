/**
 * Request-body sanitizers for the centralized model-key proxy.
 *
 * Claude Code (and some SDK builds) emit `cache_control: { type: "ephemeral",
 * scope: {...} }` on system blocks, message content blocks, and tools. The
 * public Anthropic Messages API rejects the `scope` field with a 400. We strip
 * it recursively (returning a deep copy — the input is never mutated) before
 * forwarding upstream.
 *
 * OpenAI / Gemini bodies need no such fixup; the proxy route only calls this
 * for `provider === "anthropic"`.
 */

/**
 * Remove fields the upstream Anthropic API rejects from a parsed JSON body.
 * Returns a structurally-cloned value; the input is left untouched.
 */
export function sanitizeAnthropicBody(body: unknown): unknown {
  if (Array.isArray(body)) {
    return body.map((item) => sanitizeAnthropicBody(item));
  }
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "cache_control" && v && typeof v === "object" && !Array.isArray(v)) {
        const cc = { ...(v as Record<string, unknown>) };
        delete cc.scope; // the field the Anthropic API 400s on
        out[k] = cc;
      } else {
        out[k] = sanitizeAnthropicBody(v);
      }
    }
    return out;
  }
  return body;
}
