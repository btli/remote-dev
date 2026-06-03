/**
 * Mobile PortsScreen tests (A5 / remote-dev-dk42).
 *
 * Verifies the screen lists allocations with live active/idle status and that
 * the "open" affordance is disabled while the A5 `getProxyUrl` stub returns
 * null (and active state is what drives the visible status).
 *
 * We mock `@/contexts/PortContext` so `PortProvider` is a pass-through and
 * `usePortContext` returns controlled fixtures (the real provider fetches on
 * mount, which we don't want to exercise here).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

import type { PortAllocationWithFolder } from "@/types/port";

const ALLOCATIONS: PortAllocationWithFolder[] = [
  {
    id: "a-3000",
    port: 3000,
    variableName: "PORT",
    folderId: "proj-1",
    folderName: "web",
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: "a-5173",
    port: 5173,
    variableName: "VITE_PORT",
    folderId: "proj-1",
    folderName: "web",
    isActive: false,
    createdAt: new Date(),
  },
];

const activeSet = new Set<number>([3000]);
const getProxyUrlMock = vi.fn<(port: number) => string | null>(() => null);

vi.mock("@/contexts/PortContext", () => ({
  PortProvider: ({ children }: { children: ReactNode }) => children,
  usePortContext: () => ({
    allocations: ALLOCATIONS,
    loading: false,
    isPortActive: (port: number) => activeSet.has(port),
    getProxyUrl: getProxyUrlMock,
  }),
}));

import { PortsScreen } from "../PortsScreen";

describe("mobile PortsScreen", () => {
  beforeEach(() => {
    cleanup();
    getProxyUrlMock.mockClear();
  });

  it("lists allocations with active/idle status", () => {
    render(<PortsScreen onBack={() => {}} />);

    const rows = screen.getAllByTestId("mobile-ports-row");
    expect(rows).toHaveLength(2);

    const active = rows.find((r) => r.dataset.active === "true");
    const idle = rows.find((r) => r.dataset.active === "false");
    expect(active).toBeDefined();
    expect(idle).toBeDefined();
    expect(active).toHaveTextContent(":3000");
    expect(idle).toHaveTextContent(":5173");
  });

  it("keeps the open affordance disabled while getProxyUrl returns null", () => {
    render(<PortsScreen onBack={() => {}} />);

    // Even the active (3000) port's open button is disabled because the A5
    // stub yields no URL.
    const openButtons = screen.getAllByTestId("mobile-ports-open");
    expect(openButtons).toHaveLength(2);
    for (const btn of openButtons) {
      expect(btn).toBeDisabled();
    }
  });
});
