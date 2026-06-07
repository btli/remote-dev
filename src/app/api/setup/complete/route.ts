import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { setupConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import { createLogger } from "@/lib/logger";
import { isSetupRequestAllowed } from "@/lib/setup-gate";

const log = createLogger("api/setup");

interface SetupConfiguration {
  workingDirectory: string;
  nextPort: number;
  terminalPort: number;
  wslDistribution?: string;
  autoStart: boolean;
  checkForUpdates: boolean;
}

/**
 * POST /api/setup/complete
 * Saves the setup configuration to the database.
 *
 * Gated by `isSetupRequestAllowed()` (remote-dev-2rob): permitted only while
 * first-run setup is incomplete (the wizard runs before any session exists) OR
 * for an authenticated session; otherwise 401. This prevents an unauthenticated
 * caller from rewriting the setup config once setup has completed.
 */
export async function POST(request: NextRequest) {
  if (!(await isSetupRequestAllowed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const config: SetupConfiguration = await request.json();

    // Validate configuration
    if (!config.workingDirectory) {
      return NextResponse.json(
        { error: "Working directory is required" },
        { status: 400 }
      );
    }

    // Check if working directory exists
    if (!existsSync(config.workingDirectory)) {
      return NextResponse.json(
        { error: "Working directory does not exist" },
        { status: 400 }
      );
    }

    if (config.nextPort < 1024 || config.nextPort > 65535) {
      return NextResponse.json(
        { error: "Next.js port must be between 1024 and 65535" },
        { status: 400 }
      );
    }

    if (config.terminalPort < 1024 || config.terminalPort > 65535) {
      return NextResponse.json(
        { error: "Terminal port must be between 1024 and 65535" },
        { status: 400 }
      );
    }

    if (config.nextPort === config.terminalPort) {
      return NextResponse.json(
        { error: "Ports must be different" },
        { status: 400 }
      );
    }

    // Check if config already exists
    const existing = await db.query.setupConfig.findFirst();

    if (existing) {
      // Update existing config
      await db
        .update(setupConfig)
        .set({
          workingDirectory: config.workingDirectory,
          nextPort: config.nextPort,
          terminalPort: config.terminalPort,
          wslDistribution: config.wslDistribution,
          autoStart: config.autoStart,
          checkForUpdates: config.checkForUpdates,
          isComplete: true,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(setupConfig.id, existing.id));
    } else {
      // Insert new config
      await db.insert(setupConfig).values({
        workingDirectory: config.workingDirectory,
        nextPort: config.nextPort,
        terminalPort: config.terminalPort,
        wslDistribution: config.wslDistribution,
        autoStart: config.autoStart,
        checkForUpdates: config.checkForUpdates,
        isComplete: true,
        completedAt: new Date(),
      });
    }

    return NextResponse.json({
      success: true,
      message: "Setup completed successfully",
    });
  } catch (error) {
    log.error("Setup completion failed", { error: String(error) });
    return NextResponse.json(
      { error: "Failed to save setup configuration" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/setup/complete
 * Checks if setup has been completed.
 *
 * Contract (remote-dev-2rob): the `{ isComplete: boolean }` flag is always
 * public — it is cheap and needed to decide whether to even show the wizard. The
 * stored `config` payload (working-directory path, ports, WSL distro) is
 * disclosed ONLY when `isSetupRequestAllowed()` permits it (i.e. setup is still
 * incomplete, or the caller is authenticated). Once setup is complete, an
 * unauthenticated caller gets just `{ isComplete: true }` with no config.
 */
export async function GET() {
  try {
    const config = await db.query.setupConfig.findFirst();

    if (!config || !config.isComplete) {
      return NextResponse.json({
        isComplete: false,
      });
    }

    // Setup is complete: only reveal the stored config to an allowed caller.
    if (!(await isSetupRequestAllowed())) {
      return NextResponse.json({
        isComplete: true,
      });
    }

    return NextResponse.json({
      isComplete: true,
      config: {
        workingDirectory: config.workingDirectory,
        nextPort: config.nextPort,
        terminalPort: config.terminalPort,
        wslDistribution: config.wslDistribution,
        autoStart: config.autoStart,
        checkForUpdates: config.checkForUpdates,
      },
    });
  } catch (error) {
    log.error("Setup status check failed", { error: String(error) });
    return NextResponse.json(
      { error: "Failed to check setup status" },
      { status: 500 }
    );
  }
}
