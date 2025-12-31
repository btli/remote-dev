import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as AgentCLIService from "@/services/agent-cli-service";
import type { AgentProvider } from "@/types/agent";

/**
 * GET /api/agent-cli/status - Get status of all AI coding CLIs
 *
 * Returns installation status, versions, and paths for all supported CLIs.
 */
export const GET = withAuth(async (request) => {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") as AgentProvider | null;

  if (provider && provider !== "all") {
    // Check single provider
    const status = await AgentCLIService.checkCLIStatus(provider);

    return NextResponse.json({
      ...status,
      installInstructions: status.installed
        ? undefined
        : AgentCLIService.getInstallInstructions(provider),
      docsUrl: AgentCLIService.getProviderDocsUrl(provider),
      requiredEnvVars: AgentCLIService.getRequiredEnvVars(provider),
    });
  }

  // Check all providers
  const allStatus = await AgentCLIService.checkAllCLIStatus();

  // Enhance with additional info
  const enhancedStatuses = allStatus.statuses.map((status) => ({
    ...status,
    installInstructions: status.installed
      ? undefined
      : AgentCLIService.getInstallInstructions(
          status.provider as Exclude<AgentProvider, "all">
        ),
    docsUrl: AgentCLIService.getProviderDocsUrl(
      status.provider as Exclude<AgentProvider, "all">
    ),
    requiredEnvVars: AgentCLIService.getRequiredEnvVars(
      status.provider as Exclude<AgentProvider, "all">
    ),
  }));

  return NextResponse.json({
    statuses: enhancedStatuses,
    installedCount: allStatus.installedCount,
    totalCount: allStatus.totalCount,
    summary: `${allStatus.installedCount}/${allStatus.totalCount} CLIs installed`,
  });
});

/**
 * POST /api/agent-cli/status - Verify CLI execution with environment
 *
 * Tests that a CLI can be executed with the provided environment variables.
 */
export const POST = withAuth(async (request) => {
  let body: { provider?: string; env?: Record<string, string> };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { provider, env = {} } = body;

  if (!provider || provider === "all") {
    return errorResponse("Provider is required and cannot be 'all'", 400);
  }

  const validProviders = ["claude", "codex", "gemini", "opencode"];
  if (!validProviders.includes(provider)) {
    return errorResponse(`Invalid provider: ${provider}`, 400);
  }

  // Check required environment variables
  const envCheck = AgentCLIService.checkRequiredEnvVars(
    provider as Exclude<AgentProvider, "all">,
    { ...process.env, ...env }
  );

  if (!envCheck.valid) {
    return NextResponse.json(
      {
        success: false,
        error: `Missing required environment variables: ${envCheck.missing.join(", ")}`,
        missing: envCheck.missing,
      },
      { status: 400 }
    );
  }

  // Verify CLI execution
  const result = await AgentCLIService.verifyCLIExecution(
    provider as Exclude<AgentProvider, "all">,
    env
  );

  return NextResponse.json(result);
});
