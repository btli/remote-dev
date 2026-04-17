import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupWizardProvider, useSetupWizard } from "./SetupWizardContext";
import type { SetupConfiguration } from "./types";

const savedConfig: SetupConfiguration = {
  workingDirectory: "/Users/example/work",
  nextPort: 6001,
  terminalPort: 6002,
  autoStart: true,
  checkForUpdates: false,
  wslDistribution: "Ubuntu",
};

function Probe() {
  const { isComplete, configuration } = useSetupWizard();

  return (
    <div>
      <span data-testid="is-complete">{String(isComplete)}</span>
      <span data-testid="working-directory">{configuration.workingDirectory}</span>
      <span data-testid="next-port">{configuration.nextPort}</span>
    </div>
  );
}

function mockElectron(
  overrides: Partial<Window["electron"]>
): Window["electron"] {
  return overrides as Window["electron"];
}

describe("SetupWizardProvider", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "electron");
    vi.unstubAllGlobals();
  });

  it("loads saved Electron setup config on mount", async () => {
    Object.defineProperty(window, "electron", {
      configurable: true,
      writable: true,
      value: mockElectron({
      detectPlatform: vi.fn(),
      checkDependencies: vi.fn(),
      installDependency: vi.fn(),
      selectDirectory: vi.fn(),
      saveSetupConfig: vi.fn(),
      getSetupConfig: vi.fn().mockResolvedValue({
        isComplete: true,
        config: savedConfig,
      }),
      }),
    });

    render(
      <SetupWizardProvider>
        <Probe />
      </SetupWizardProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("is-complete")).toHaveTextContent("true")
    );

    expect(screen.getByTestId("working-directory")).toHaveTextContent(
      savedConfig.workingDirectory
    );
    expect(screen.getByTestId("next-port")).toHaveTextContent(
      String(savedConfig.nextPort)
    );
  });

  it("loads saved setup config from the web API when Electron is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        isComplete: true,
        config: savedConfig,
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    render(
      <SetupWizardProvider>
        <Probe />
      </SetupWizardProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("is-complete")).toHaveTextContent("true")
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/setup/complete");
    expect(screen.getByTestId("working-directory")).toHaveTextContent(
      savedConfig.workingDirectory
    );
    expect(screen.getByTestId("next-port")).toHaveTextContent(
      String(savedConfig.nextPort)
    );
  });
});
