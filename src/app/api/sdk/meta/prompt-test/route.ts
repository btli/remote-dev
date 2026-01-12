/**
 * Prompt Test API - Test prompts with configurable parameters
 *
 * POST /api/sdk/meta/prompt-test
 *
 * Tests a prompt with specified parameters and returns the output
 * along with usage statistics and timing information.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import * as ApiKeyService from "@/services/api-key-service";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PromptTestRequest {
  prompt: string;
  parameters: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
    presencePenalty?: number;
    frequencyPenalty?: number;
  };
  provider?: "claude" | "codex" | "gemini" | "opencode";
}

interface PromptTestResponse {
  output: string;
  durationMs: number;
  tokensPerSecond: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<{
    type: "text";
    text: string;
  }>;
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicError {
  type: "error";
  error: {
    type: string;
    message: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication
// ─────────────────────────────────────────────────────────────────────────────

async function authenticateRequest(request: Request): Promise<string | null> {
  const session = await getAuthSession();
  if (session?.user?.id) {
    return session.user.id;
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.substring(7);
    const validated = await ApiKeyService.validateApiKey(apiKey);
    if (validated) {
      return validated.userId;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Authenticate
  const userId = await authenticateRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse request body
  let body: PromptTestRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate required fields
  if (!body.prompt || typeof body.prompt !== "string") {
    return NextResponse.json(
      { error: "Prompt is required and must be a string" },
      { status: 400 }
    );
  }

  if (body.prompt.length > 100000) {
    return NextResponse.json(
      { error: "Prompt exceeds maximum length of 100,000 characters" },
      { status: 400 }
    );
  }

  // Extract parameters with defaults
  const {
    temperature = 0.7,
    maxTokens = 4096,
    topP = 0.95,
    topK = 40,
    stopSequences = [],
  } = body.parameters || {};

  const provider = body.provider || "claude";

  // Currently only Claude is supported for prompt testing
  if (provider !== "claude") {
    return NextResponse.json(
      { error: `Provider ${provider} is not yet supported for prompt testing. Only 'claude' is available.` },
      { status: 400 }
    );
  }

  // Check for API key
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const startTime = Date.now();

  try {
    // Call Claude API via fetch
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: Math.min(maxTokens, 8192),
        temperature,
        top_p: topP,
        top_k: topK,
        stop_sequences: stopSequences.length > 0 ? stopSequences : undefined,
        messages: [
          {
            role: "user",
            content: body.prompt,
          },
        ] satisfies AnthropicMessage[],
      }),
    });

    const endTime = Date.now();
    const durationMs = endTime - startTime;

    if (!response.ok) {
      const errorData = (await response.json()) as AnthropicError;
      return NextResponse.json(
        {
          error: errorData.error?.message || `API error: ${response.status}`,
          code: response.status,
          durationMs,
        },
        { status: response.status }
      );
    }

    const data = (await response.json()) as AnthropicResponse;

    // Extract text content
    const textContent = data.content.find((c) => c.type === "text");
    const output = textContent?.text || "";

    // Calculate usage
    const inputTokens = data.usage.input_tokens;
    const outputTokens = data.usage.output_tokens;
    const totalTokens = inputTokens + outputTokens;
    const tokensPerSecond = durationMs > 0 ? (outputTokens / durationMs) * 1000 : 0;

    const result: PromptTestResponse = {
      output,
      durationMs,
      tokensPerSecond,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
      },
    };

    return NextResponse.json(result);
  } catch (err) {
    const endTime = Date.now();
    const durationMs = endTime - startTime;

    console.error("[Prompt Test] Error:", err);

    const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";

    return NextResponse.json(
      {
        error: errorMessage,
        durationMs,
      },
      { status: 500 }
    );
  }
}
