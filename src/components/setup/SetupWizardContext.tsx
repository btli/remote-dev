"use client";

/**
 * Setup Wizard Context
 *
 * Manages state for the first-run setup wizard, including:
 * - Platform detection
 * - Dependency checking and installation
 * - Configuration settings
 * - Navigation between steps
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  ReactNode,
} from "react";
import {
  SetupState,
  SetupContextValue,
  SetupStep,
  SetupConfiguration,
  PlatformInfo,
  DependencyStatus,
  SETUP_STEPS,
  DEFAULT_CONFIGURATION,
} from "./types";

// Type for electron API in window object
interface ElectronSetupAPI {
  detectPlatform: () => Promise<PlatformInfo>;
  checkDependencies: () => Promise<DependencyStatus[]>;
  installDependency: (name: string) => Promise<{ success: boolean; error?: string }>;
  selectDirectory: () => Promise<string | null>;
  saveSetupConfig: (config: SetupConfiguration) => Promise<void>;
}

// Helper to get electron API if available
function getElectronAPI(): ElectronSetupAPI | null {
  if (typeof window !== "undefined" && "electron" in window) {
    return window.electron as unknown as ElectronSetupAPI;
  }
  return null;
}

// Initial state
const initialState: SetupState = {
  currentStep: "welcome",
  platform: null,
  dependencies: [],
  configuration: DEFAULT_CONFIGURATION,
  isLoading: false,
  error: null,
  isComplete: false,
};

// Action types
type SetupAction =
  | { type: "SET_STEP"; step: SetupStep }
  | { type: "SET_PLATFORM"; platform: PlatformInfo }
  | { type: "SET_DEPENDENCIES"; dependencies: DependencyStatus[] }
  | { type: "UPDATE_DEPENDENCY"; name: string; update: Partial<DependencyStatus> }
  | { type: "UPDATE_CONFIGURATION"; config: Partial<SetupConfiguration> }
  | { type: "SET_LOADING"; isLoading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "SET_COMPLETE" }
  | { type: "SKIP_SETUP" };

// Reducer
function setupReducer(state: SetupState, action: SetupAction): SetupState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, currentStep: action.step };
    case "SET_PLATFORM":
      return {
        ...state,
        platform: action.platform,
        configuration: {
          ...state.configuration,
          workingDirectory:
            state.configuration.workingDirectory || action.platform.homeDirectory,
          wslDistribution:
            action.platform.isWSL && action.platform.wslDistros?.[0]?.name
              ? action.platform.wslDistros[0].name
              : undefined,
        },
      };
    case "SET_DEPENDENCIES":
      return { ...state, dependencies: action.dependencies };
    case "UPDATE_DEPENDENCY":
      return {
        ...state,
        dependencies: state.dependencies.map((dep) =>
          dep.name === action.name ? { ...dep, ...action.update } : dep
        ),
      };
    case "UPDATE_CONFIGURATION":
      return {
        ...state,
        configuration: { ...state.configuration, ...action.config },
      };
    case "SET_LOADING":
      return { ...state, isLoading: action.isLoading };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "SET_COMPLETE":
      return { ...state, isComplete: true };
    case "SKIP_SETUP":
      return { ...state, isComplete: true };
    default:
      return state;
  }
}

// Create context
const SetupWizardContext = createContext<SetupContextValue | null>(null);

// Provider component
export function SetupWizardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(setupReducer, initialState);

  // Navigation
  const goToStep = useCallback((step: SetupStep) => {
    dispatch({ type: "SET_STEP", step });
  }, []);

  const nextStep = useCallback(() => {
    const currentIndex = SETUP_STEPS.indexOf(state.currentStep);
    if (currentIndex < SETUP_STEPS.length - 1) {
      dispatch({ type: "SET_STEP", step: SETUP_STEPS[currentIndex + 1] });
    }
  }, [state.currentStep]);

  const prevStep = useCallback(() => {
    const currentIndex = SETUP_STEPS.indexOf(state.currentStep);
    if (currentIndex > 0) {
      dispatch({ type: "SET_STEP", step: SETUP_STEPS[currentIndex - 1] });
    }
  }, [state.currentStep]);

  const canProceed = useCallback((): boolean => {
    switch (state.currentStep) {
      case "welcome":
        return true;
      case "platform":
        return state.platform !== null;
      case "dependencies":
        // Can proceed if all required dependencies are installed
        return state.dependencies
          .filter((d) => d.required)
          .every((d) => d.installed);
      case "configuration":
        return (
          state.configuration.workingDirectory.length > 0 &&
          state.configuration.nextPort > 0 &&
          state.configuration.terminalPort > 0
        );
      case "completion":
        return true;
      default:
        return false;
    }
  }, [state.currentStep, state.platform, state.dependencies, state.configuration]);

  // Platform detection
  const detectPlatform = useCallback(async () => {
    dispatch({ type: "SET_LOADING", isLoading: true });
    dispatch({ type: "SET_ERROR", error: null });

    try {
      const electron = getElectronAPI();
      if (electron) {
        const platform = await electron.detectPlatform();
        dispatch({ type: "SET_PLATFORM", platform });
      } else {
        // Fallback to API route
        const response = await fetch("/api/setup/platform");
        if (!response.ok) {
          throw new Error("Failed to detect platform");
        }
        const platform = await response.json();
        dispatch({ type: "SET_PLATFORM", platform });
      }
    } catch (error) {
      dispatch({
        type: "SET_ERROR",
        error: error instanceof Error ? error.message : "Platform detection failed",
      });
    } finally {
      dispatch({ type: "SET_LOADING", isLoading: false });
    }
  }, []);

  const selectWslDistro = useCallback((distro: string) => {
    dispatch({
      type: "UPDATE_CONFIGURATION",
      config: { wslDistribution: distro },
    });
  }, []);

  // Dependencies
  const checkDependencies = useCallback(async () => {
    dispatch({ type: "SET_LOADING", isLoading: true });
    dispatch({ type: "SET_ERROR", error: null });

    try {
      const electron = getElectronAPI();
      if (electron) {
        const dependencies = await electron.checkDependencies();
        dispatch({ type: "SET_DEPENDENCIES", dependencies });
      } else {
        // Fallback to API route
        const response = await fetch("/api/setup/dependencies");
        if (!response.ok) {
          throw new Error("Failed to check dependencies");
        }
        const dependencies = await response.json();
        dispatch({ type: "SET_DEPENDENCIES", dependencies });
      }
    } catch (error) {
      dispatch({
        type: "SET_ERROR",
        error: error instanceof Error ? error.message : "Dependency check failed",
      });
    } finally {
      dispatch({ type: "SET_LOADING", isLoading: false });
    }
  }, []);

  const installDependency = useCallback(
    async (name: string): Promise<boolean> => {
      dispatch({
        type: "UPDATE_DEPENDENCY",
        name,
        update: { status: "installing" },
      });

      try {
        const electron = getElectronAPI();
        if (electron) {
          const result = await electron.installDependency(name);
          if (result.success) {
            dispatch({
              type: "UPDATE_DEPENDENCY",
              name,
              update: { status: "installed", installed: true },
            });
            return true;
          } else {
            dispatch({
              type: "UPDATE_DEPENDENCY",
              name,
              update: { status: "error", error: result.error },
            });
            return false;
          }
        } else {
          // Fallback to API route
          const response = await fetch("/api/setup/install", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dependency: name }),
          });

          const result = await response.json();
          if (result.success) {
            dispatch({
              type: "UPDATE_DEPENDENCY",
              name,
              update: { status: "installed", installed: true },
            });
            return true;
          } else {
            dispatch({
              type: "UPDATE_DEPENDENCY",
              name,
              update: { status: "error", error: result.error },
            });
            return false;
          }
        }
      } catch (error) {
        dispatch({
          type: "UPDATE_DEPENDENCY",
          name,
          update: {
            status: "error",
            error: error instanceof Error ? error.message : "Installation failed",
          },
        });
        return false;
      }
    },
    []
  );

  // Configuration
  const updateConfiguration = useCallback(
    (config: Partial<SetupConfiguration>) => {
      dispatch({ type: "UPDATE_CONFIGURATION", config });
    },
    []
  );

  const validateConfiguration = useCallback(async (): Promise<boolean> => {
    // Basic validation
    const { workingDirectory, nextPort, terminalPort } = state.configuration;

    if (!workingDirectory) {
      dispatch({ type: "SET_ERROR", error: "Working directory is required" });
      return false;
    }

    if (nextPort < 1024 || nextPort > 65535) {
      dispatch({ type: "SET_ERROR", error: "Next.js port must be between 1024 and 65535" });
      return false;
    }

    if (terminalPort < 1024 || terminalPort > 65535) {
      dispatch({
        type: "SET_ERROR",
        error: "Terminal port must be between 1024 and 65535",
      });
      return false;
    }

    if (nextPort === terminalPort) {
      dispatch({ type: "SET_ERROR", error: "Ports must be different" });
      return false;
    }

    dispatch({ type: "SET_ERROR", error: null });
    return true;
  }, [state.configuration]);

  // Completion
  const completeSetup = useCallback(async () => {
    dispatch({ type: "SET_LOADING", isLoading: true });
    dispatch({ type: "SET_ERROR", error: null });

    try {
      const electron = getElectronAPI();
      if (electron) {
        await electron.saveSetupConfig(state.configuration);
      } else {
        const response = await fetch("/api/setup/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(state.configuration),
        });

        if (!response.ok) {
          throw new Error("Failed to save configuration");
        }
      }

      dispatch({ type: "SET_COMPLETE" });
    } catch (error) {
      dispatch({
        type: "SET_ERROR",
        error: error instanceof Error ? error.message : "Failed to complete setup",
      });
    } finally {
      dispatch({ type: "SET_LOADING", isLoading: false });
    }
  }, [state.configuration]);

  const skipSetup = useCallback(() => {
    dispatch({ type: "SKIP_SETUP" });
  }, []);

  const contextValue: SetupContextValue = {
    ...state,
    goToStep,
    nextStep,
    prevStep,
    canProceed,
    detectPlatform,
    selectWslDistro,
    checkDependencies,
    installDependency,
    updateConfiguration,
    validateConfiguration,
    completeSetup,
    skipSetup,
  };

  return (
    <SetupWizardContext.Provider value={contextValue}>
      {children}
    </SetupWizardContext.Provider>
  );
}

// Hook to use the context
export function useSetupWizard() {
  const context = useContext(SetupWizardContext);
  if (!context) {
    throw new Error("useSetupWizard must be used within a SetupWizardProvider");
  }
  return context;
}
