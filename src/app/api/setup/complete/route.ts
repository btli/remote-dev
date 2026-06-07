import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { setupConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import { createLogger } from "@/lib/logger";
import { hasValidSession, isFirstRunOpen, isSetupRequestAllowed } from "@/lib/setup-gate";

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
 * Sentinel thrown inside the POST transaction when the in-transaction re-check
 * finds setup already complete and the caller is unauthenticated. It rolls the
 * transaction back (writing nothing) and is mapped to a 401 by the catch below.
 */
class SetupForbiddenError extends Error {}

/**
 * POST /api/setup/complete
 * Saves the setup configuration to the database.
 *
 * Authorized via the setup gate (remote-dev-2rob): permitted only while first-run
 * setup is OPEN (unscoped + not yet complete — the wizard runs before any session
 * exists) OR for an authenticated session; otherwise 401. In scoped instance mode
 * a real session is always required. This prevents an unauthenticated caller from
 * rewriting the setup config once setup has completed.
 *
 * The session is resolved ONCE up front, then the read-decide-write runs inside a
 * single DB transaction that RE-CHECKS completion with `tx`. This closes the
 * TOCTOU race (codex Medium 2) where two concurrent unauthenticated first-run
 * POSTs both pass the initial gate and the later one overwrites a just-completed
 * config: the in-transaction re-check rejects an unauthenticated write whenever
 * the row is already complete. Residual benign edge: two genuinely-concurrent
 * FIRST-run writers (both seeing no/incomplete row) can still both insert/update —
 * acceptable, since neither overwrites a completed config and `setup_config` has
 * no singleton constraint (a no-migration fix). We use a plain transaction: the
 * libsql driver ignores the `behavior` config (its signature names it `_config`),
 * and `db` is the libsql-typed handle even when PostgreSQL is the live backend, so
 * a behavior option would be a runtime no-op on both dialects; the in-transaction
 * re-read is what actually closes the security-relevant case.
 */
export async function POST(request: NextRequest) {
  // Resolve the session ONCE so the gate and the in-transaction re-check agree
  // and we never double-call getAuthSession().
  const authed = await hasValidSession();
  if (!authed && !(await isFirstRunOpen())) {
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

    // Read-decide-write atomically so a concurrent POST cannot complete setup
    // between our re-check and our write (TOCTOU). Re-fetch WITH `tx`.
    await db.transaction(async (tx) => {
      const existing = await tx.query.setupConfig.findFirst();

      // If setup is already complete, only an authenticated caller may overwrite
      // it. Roll back (write nothing) and surface as a 401.
      if (existing?.isComplete && !authed) {
        throw new SetupForbiddenError();
      }

      if (existing) {
        // Update existing config
        await tx
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
        await tx.insert(setupConfig).values({
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
    });

    return NextResponse.json({
      success: true,
      message: "Setup completed successfully",
    });
  } catch (error) {
    if (error instanceof SetupForbiddenError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
