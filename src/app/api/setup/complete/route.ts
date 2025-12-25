import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { setupConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import { existsSync } from "fs";

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
 * Saves the setup configuration to the database
 *
 * This route is public (no auth) for first-run setup.
 */
export async function POST(request: NextRequest) {
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
    console.error("Setup completion failed:", error);
    return NextResponse.json(
      { error: "Failed to save setup configuration" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/setup/complete
 * Checks if setup has been completed
 */
export async function GET() {
  try {
    const config = await db.query.setupConfig.findFirst();

    if (!config || !config.isComplete) {
      return NextResponse.json({
        isComplete: false,
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
    console.error("Setup status check failed:", error);
    return NextResponse.json(
      { error: "Failed to check setup status" },
      { status: 500 }
    );
  }
}
