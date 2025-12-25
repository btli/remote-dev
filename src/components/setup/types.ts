/**
 * Setup Wizard Types
 *
 * Type definitions for the first-run setup wizard.
 */

export type SetupStep =
  | "welcome"
  | "platform"
  | "dependencies"
  | "configuration"
  | "completion";

export const SETUP_STEPS: SetupStep[] = [
  "welcome",
  "platform",
  "dependencies",
  "configuration",
  "completion",
];

export interface PlatformInfo {
  os: "darwin" | "linux" | "win32";
  arch: "x64" | "arm64" | "arm";
  isWSL: boolean;
  wslDistros?: WslDistribution[];
  packageManager?: string;
  shell: string;
  homeDirectory: string;
}

export interface WslDistribution {
  name: string;
  version: number;
  isDefault: boolean;
  state: "Running" | "Stopped" | "Installing" | "Unknown";
}

export interface DependencyStatus {
  name: string;
  displayName: string;
  required: boolean;
  installed: boolean;
  version?: string;
  status: "checking" | "installed" | "missing" | "installing" | "error";
  error?: string;
  installCommand?: string;
  downloadUrl?: string;
}

export interface SetupConfiguration {
  workingDirectory: string;
  nextPort: number;
  terminalPort: number;
  wslDistribution?: string;
  autoStart: boolean;
  checkForUpdates: boolean;
}

export interface SetupState {
  currentStep: SetupStep;
  platform: PlatformInfo | null;
  dependencies: DependencyStatus[];
  configuration: SetupConfiguration;
  isLoading: boolean;
  error: string | null;
  isComplete: boolean;
}

export interface SetupContextValue extends SetupState {
  // Navigation
  goToStep: (step: SetupStep) => void;
  nextStep: () => void;
  prevStep: () => void;
  canProceed: () => boolean;

  // Platform detection
  detectPlatform: () => Promise<void>;
  selectWslDistro: (distro: string) => void;

  // Dependencies
  checkDependencies: () => Promise<void>;
  installDependency: (name: string) => Promise<boolean>;

  // Configuration
  updateConfiguration: (config: Partial<SetupConfiguration>) => void;
  validateConfiguration: () => Promise<boolean>;

  // Completion
  completeSetup: () => Promise<void>;
  skipSetup: () => void;
}

export const DEFAULT_CONFIGURATION: SetupConfiguration = {
  workingDirectory: "",
  nextPort: 3000,
  terminalPort: 3001,
  autoStart: true,
  checkForUpdates: true,
};
