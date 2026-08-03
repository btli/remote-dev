import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as AgentCLIService from "@/services/agent-cli-service";
import type { AgentCLIProvider } from "@/services/agent-cli-service";

/**
 * GET /api/agent-cli/status - Get status of all AI coding CLIs
 *
 * Returns installation status, versions, and paths for all supported CLIs.
 */
export const GET = withAuth(async (request) => {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");

  if (provider && provider !== "all") {
    if (!AgentCLIService.AGENT_CLI_PROVIDERS.includes(provider as AgentCLIProvider)) {
      return errorResponse(`Invalid provider: ${provider}`, 400);
    }
    const cliProvider = provider as AgentCLIProvider;
    // Check single provider
    const status = await AgentCLIService.checkCLIStatus(cliProvider);

    return NextResponse.json({
      ...status,
      installInstructions: status.installed
        ? undefined
        : AgentCLIService.getInstallInstructions(cliProvider),
      docsUrl: AgentCLIService.getProviderDocsUrl(cliProvider),
      requiredEnvVars: AgentCLIService.getRequiredEnvVars(cliProvider),
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
          status.provider
        ),
    docsUrl: AgentCLIService.getProviderDocsUrl(
      status.provider
    ),
    requiredEnvVars: AgentCLIService.getRequiredEnvVars(
      status.provider
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

  if (!AgentCLIService.AGENT_CLI_PROVIDERS.includes(provider as AgentCLIProvider)) {
    return errorResponse(`Invalid provider: ${provider}`, 400);
  }

  // Check required environment variables
  const envCheck = AgentCLIService.checkRequiredEnvVars(
    provider as AgentCLIProvider,
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
    provider as AgentCLIProvider,
    env
  );

  return NextResponse.json(result);
});
