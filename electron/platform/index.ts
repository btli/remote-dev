/**
 * Platform Abstraction Layer
 *
 * Provides unified cross-platform functionality for:
 * - Platform detection (macOS, Linux, Windows/WSL)
 * - WSL integration on Windows
 * - Dependency detection and installation
 * - Platform-aware command execution
 */

// Types
export * from "./types";

// WSL Service
export {
  isWindows,
  getWslInfo,
  listDistributions,
  getDefaultDistribution,
  validateDistribution,
  windowsToWslPath,
  wslToWindowsPath,
  getWslHomeDirectory,
  getWslUsername,
  testWslConnection,
  wslCommandExists,
  runInWsl,
  clearWslCache,
  buildWslEnv,
} from "./wsl-service";

// Platform Service
export {
  detectPlatform,
  getAdapter,
  checkAllDependencies,
  getDependencyInfo,
  clearPlatformCache,
  commandExists,
  getCommandVersion,
} from "./platform-service";

// Platform Execution
export {
  platformExecFile,
  platformSpawn,
  getWslConfig,
  setWslConfig,
  shouldUseWsl,
  getShell,
  getWslShell,
} from "./platform-exec";

// Adapters
export { MacOSAdapter } from "./adapters/macos";
export { LinuxAdapter } from "./adapters/linux";
export { WindowsAdapter } from "./adapters/windows";
