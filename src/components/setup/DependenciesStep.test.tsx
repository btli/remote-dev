import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SetupContextValue } from "./types";

const mockContext: SetupContextValue = {
  currentStep: "dependencies",
  platform: null,
  dependencies: [
    {
      name: "bun",
      displayName: "Bun",
      required: true,
      installed: false,
      status: "missing",
      installCommand: "curl -fsSL https://bun.sh/install | bash",
    },
  ],
  configuration: {
    workingDirectory: "",
    nextPort: 3000,
    terminalPort: 3001,
    autoStart: true,
    checkForUpdates: true,
  },
  isLoading: false,
  error: null,
  isComplete: false,
  goToStep: vi.fn(),
  nextStep: vi.fn(),
  prevStep: vi.fn(),
  canProceed: vi.fn().mockReturnValue(false),
  detectPlatform: vi.fn(),
  selectWslDistro: vi.fn(),
  checkDependencies: vi.fn(),
  installDependency: vi.fn(),
  updateConfiguration: vi.fn(),
  validateConfiguration: vi.fn(),
  completeSetup: vi.fn(),
  skipSetup: vi.fn(),
};

vi.mock("./SetupWizardContext", () => ({
  useSetupWizard: () => mockContext,
}));

import { DependenciesStep } from "./DependenciesStep";

describe("DependenciesStep", () => {
  it("shows manual install guidance instead of an auto-install action", () => {
    render(<DependenciesStep />);

    expect(
      screen.queryByRole("button", { name: /auto install/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Install this dependency manually, then re-check\./i)
    ).toBeInTheDocument();
  });
});
