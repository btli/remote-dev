"use client";

/**
 * PortsScreen — Profile › Ports.
 *
 * Lists the user's port allocations with live active/idle status sourced from
 * `PortContext` (the `GET /api/ports/proxyable` seam). Where a port is live and
 * has a proxy target, an "open" affordance calls the same `getProxyUrl` seam.
 *
 * The seam is inert in this PR (A5): `getProxyUrl` returns `null`, so the open
 * affordance stays disabled until Track B (B2 / remote-dev-kmrx) wires the
 * real proxy URL (mobile then bridges to `launchUrl`/`Linking.openURL`).
 *
 * The mobile Profile surface is not mounted inside the desktop provider tree,
 * so this screen wraps its body in its own `PortProvider`.
 */

import { ExternalLink, Network, Radio } from "lucide-react";

import { PortProvider, usePortContext } from "@/contexts/PortContext";
import { cn } from "@/lib/utils";

import { SubScreen } from "../SubScreen";

export interface PortsScreenProps {
  onBack: () => void;
}

export function PortsScreen({ onBack }: PortsScreenProps) {
  return (
    <SubScreen title="Ports" onBack={onBack}>
      <PortProvider>
        <PortsScreenBody />
      </PortProvider>
    </SubScreen>
  );
}

function PortsScreenBody() {
  const { allocations, loading, isPortActive, getProxyUrl } = usePortContext();

  if (loading && allocations.length === 0) {
    return (
      <p
        data-testid="mobile-ports-loading"
        className="px-4 py-6 text-center text-[13px] text-muted-foreground"
      >
        Loading ports…
      </p>
    );
  }

  if (allocations.length === 0) {
    return (
      <div
        data-testid="mobile-ports-empty"
        className="flex flex-col items-center gap-2 px-4 py-10 text-center"
      >
        <Network aria-hidden="true" className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-[13px] leading-snug text-muted-foreground">
          No port allocations
        </p>
        <p className="text-[12px] leading-snug text-muted-foreground/70">
          Add environment variables like PORT=3000 to a project&apos;s
          preferences.
        </p>
      </div>
    );
  }

  return (
    <ul
      data-testid="mobile-ports-list"
      className="flex flex-col divide-y divide-border"
    >
      {allocations.map((alloc) => {
        const active = isPortActive(alloc.port);
        const url = getProxyUrl(alloc.port);
        const canOpen = active && url != null;

        return (
          <li
            key={alloc.id}
            data-testid="mobile-ports-row"
            data-active={active ? "true" : "false"}
            className="flex items-center gap-3 px-4 py-3"
          >
            <Radio
              aria-hidden="true"
              className={cn(
                "h-4 w-4 shrink-0",
                active ? "text-emerald-400" : "text-muted-foreground/50"
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[14px] text-foreground">
                  :{alloc.port}
                </span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {alloc.variableName}
                </span>
              </div>
              <p className="truncate text-[12px] text-muted-foreground">
                {alloc.folderName}
              </p>
            </div>

            <span
              className={cn(
                "shrink-0 text-[11px]",
                active ? "text-emerald-400" : "text-muted-foreground/70"
              )}
            >
              {active ? "Active" : "Idle"}
            </span>

            <button
              type="button"
              onClick={() => {
                if (url) {
                  window.open(url, "_blank", "noopener,noreferrer");
                }
              }}
              disabled={!canOpen}
              aria-label={`Open port ${alloc.port}`}
              data-testid="mobile-ports-open"
              className={cn(
                "inline-flex h-9 min-w-[44px] shrink-0 items-center justify-center rounded-md",
                "text-muted-foreground active:bg-accent/40",
                "disabled:opacity-30 disabled:active:bg-transparent",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              )}
            >
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
