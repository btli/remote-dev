/**
 * Mobile PortsScreen tests (A5 / remote-dev-dk42; B2 / remote-dev-kmrx).
 *
 * Verifies the screen lists allocations with live active/idle status, keeps the
 * "open" affordance disabled when `getProxyUrl` yields no URL, and — once
 * `getProxyUrl` returns a real proxy path (B2) — opens it in a new tab.
 *
 * We mock `@/contexts/PortContext` so `PortProvider` is a pass-through and
 * `usePortContext` returns controlled fixtures (the real provider fetches on
 * mount, which we don't want to exercise here).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
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
    // Reset both calls AND implementation so per-test overrides don't leak.
    getProxyUrlMock.mockReset();
    getProxyUrlMock.mockReturnValue(null);
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
    getProxyUrlMock.mockReturnValue(null);
    render(<PortsScreen onBack={() => {}} />);

    // Even the active (3000) port's open button is disabled when there is no URL.
    const openButtons = screen.getAllByTestId("mobile-ports-open");
    expect(openButtons).toHaveLength(2);
    for (const btn of openButtons) {
      expect(btn).toBeDisabled();
    }
  });

  it("opens the proxy URL in a new tab for a live port (B2)", () => {
    getProxyUrlMock.mockImplementation((port: number) => `/proxy/${port}/`);
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);

    render(<PortsScreen onBack={() => {}} />);

    const openButtons = screen.getAllByTestId("mobile-ports-open");
    // Row order matches ALLOCATIONS: [3000 (active), 5173 (idle)].
    const [activeBtn, idleBtn] = openButtons;
    expect(activeBtn).not.toBeDisabled();
    expect(idleBtn).toBeDisabled();

    fireEvent.click(activeBtn);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      "/proxy/3000/",
      "_blank",
      "noopener,noreferrer"
    );

    openSpy.mockRestore();
  });
});
