/**
 * Shared agent-run dispatch into an instance's data plane (epic
 * remote-dev-oyej.10/.11). Both the per-instance agent-launch route and the
 * cross-instance delegation route funnel through {@link dispatchAgentRun} so the
 * wake-on-traffic + proxy logic lives (and is tested) once.
 *
 * Wake-on-traffic: a `suspended` instance is resumed (jvcx scales the
 * StatefulSet back to 1) BEFORE dispatch. The brief router blip on resume
 * (~10–30s, 502/503) is accepted (same class as jvcx's §9 image-rollout blip).
 */
import { NextResponse } from "next/server";
import type { InstanceRow, SupervisorUserRow } from "@/db/schema";
import type { Role } from "@/lib/roles";
import { instanceFetch } from "@/lib/instance-proxy";
import { requestResume } from "@/lib/lifecycle-actions";
import { createLogger } from "@/lib/logger";

const log = createLogger("agent-dispatch");

type ActingUser = Pick<SupervisorUserRow, "id" | "email"> & { role: Role };

export interface AgentRunBody {
  projectId: string;
  prompt: string;
  agentProvider?: string;
  agentFlags?: string[];
  worktreeType?: string | null;
  baseBranch?: string | null;
}

/** Injectable seam so routes can unit-test dispatch without the real proxy. */
export interface DispatchDeps {
  instanceFetch: typeof instanceFetch;
  requestResume: typeof requestResume;
}

const defaultDeps: DispatchDeps = { instanceFetch, requestResume };

/**
 * Resume (if suspended) then proxy a manual agent run into the instance's
 * `/api/agent-runs`. Returns a NextResponse mirroring the instance's response,
 * or a 409 when the instance isn't launchable.
 */
export async function dispatchAgentRun(
  user: ActingUser,
  row: InstanceRow,
  body: AgentRunBody,
  deps: DispatchDeps = defaultDeps,
): Promise<NextResponse> {
  // Wake-on-traffic: resume a suspended instance before dispatching.
  if (row.status === "suspended") {
    await deps.requestResume(user, row.id);
    log.info("woke suspended instance for agent dispatch", {
      slug: row.slug,
      actor: user.email,
    });
  }
  // Only ready/suspended (now resuming) instances are launchable.
  if (row.status !== "ready" && row.status !== "suspended") {
    return NextResponse.json(
      { error: `instance not launchable (${row.status})`, code: "NOT_READY" },
      { status: 409 },
    );
  }

  const res = await deps.instanceFetch(row, "/api/agent-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "manual", ...body }),
  });

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    payload = { error: "instance returned a non-JSON response" };
  }
  return NextResponse.json(payload, { status: res.status });
}
