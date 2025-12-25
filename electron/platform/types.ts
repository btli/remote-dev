/**
 * Platform Types
 *
 * Shared type definitions for platform abstraction layer.
 */

export type PlatformOS = "darwin" | "linux" | "win32";
export type PlatformArch = "x64" | "arm64";

export interface PlatformInfo {
  os: PlatformOS;
  arch: PlatformArch;
  isWSL: boolean;
  wslDistros?: WslDistribution[];
  packageManager?: PackageManager;
  shell: string;
  homeDirectory: string;
}

export type PackageManager =
  | "brew"
  | "apt"
  | "dnf"
  | "yum"
  | "pacman"
  | "zypper"
  | "apk"
  | "choco"
  | "winget";

export interface WslDistribution {
  name: string;
  version: number; // 1 or 2
  isDefault: boolean;
  state: "Running" | "Stopped" | "Installing" | "Unknown";
}

export interface WslInfo {
  installed: boolean;
  available: boolean;
  distributions: WslDistribution[];
  defaultDistribution: string | null;
  version: number; // Highest WSL version available
}

export interface WslConfig {
  enabled: boolean;
  distribution: string;
  homeDirectory: string;
}

export interface DependencyCheck {
  name: string;
  displayName: string;
  required: boolean;
  installed: boolean;
  version?: string;
  expectedVersion?: string;
  installCommand?: string;
  downloadUrl?: string;
  status: "checking" | "installed" | "missing" | "installing" | "error";
  error?: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  userId?: string;
  wslDistribution?: string;
  forceNative?: boolean;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PlatformAdapter {
  detectPackageManager(): Promise<PackageManager | null>;
  checkDependency(name: string): Promise<DependencyCheck>;
  installDependency(name: string): Promise<{ success: boolean; error?: string }>;
  getInstallCommand(name: string): string;
}

export class PlatformError extends Error {
  constructor(
    message: string,
    public code:
      | "WSL_NOT_INSTALLED"
      | "WSL_NOT_ENABLED"
      | "DISTRO_NOT_FOUND"
      | "PATH_TRANSLATION_FAILED"
      | "EXEC_FAILED"
      | "DEPENDENCY_MISSING"
  ) {
    super(message);
    this.name = "PlatformError";
  }
}
