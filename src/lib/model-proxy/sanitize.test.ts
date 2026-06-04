// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sanitizeAnthropicBody } from "./sanitize";

describe("sanitizeAnthropicBody", () => {
  it("strips cache_control.scope wherever it appears, preserving every other field", () => {
    const input = {
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      temperature: 0,
      system: [
        {
          type: "text",
          text: "system prompt",
          cache_control: { type: "ephemeral", scope: { type: "context" } },
        },
      ],
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "block",
              cache_control: { type: "ephemeral", scope: { type: "context", ttl: "5m" } },
            },
          ],
        },
      ],
      tools: [
        {
          name: "do_thing",
          input_schema: { type: "object" },
          cache_control: { type: "ephemeral", scope: { foo: "bar" } },
        },
      ],
    };

    const expectedNoScope = {
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      temperature: 0,
      system: [
        {
          type: "text",
          text: "system prompt",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "block",
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ],
      tools: [
        {
          name: "do_thing",
          input_schema: { type: "object" },
          cache_control: { type: "ephemeral" },
        },
      ],
    };

    expect(sanitizeAnthropicBody(input)).toEqual(expectedNoScope);
  });

  it("does not mutate the input object", () => {
    const input = {
      system: [{ cache_control: { type: "ephemeral", scope: { x: 1 } } }],
    };
    sanitizeAnthropicBody(input);
    expect(input.system[0].cache_control).toEqual({ type: "ephemeral", scope: { x: 1 } });
  });

  it("preserves a cache_control with no scope unchanged", () => {
    const input = { cache_control: { type: "ephemeral" }, other: true };
    expect(sanitizeAnthropicBody(input)).toEqual({ cache_control: { type: "ephemeral" }, other: true });
  });

  it("passes primitives and arrays through structurally", () => {
    expect(sanitizeAnthropicBody("str")).toBe("str");
    expect(sanitizeAnthropicBody(42)).toBe(42);
    expect(sanitizeAnthropicBody(null)).toBe(null);
    expect(sanitizeAnthropicBody([1, 2, { cache_control: { type: "ephemeral", scope: {} } }])).toEqual([
      1,
      2,
      { cache_control: { type: "ephemeral" } },
    ]);
  });
});
