"use client";

/**
 * Setup Wizard
 *
 * Main component that orchestrates the first-run setup experience.
 */

import { useSetupWizard, SetupWizardProvider } from "./SetupWizardContext";
import { WelcomeStep } from "./WelcomeStep";
import { PlatformStep } from "./PlatformStep";
import { DependenciesStep } from "./DependenciesStep";
import { ConfigurationStep } from "./ConfigurationStep";
import { CompletionStep } from "./CompletionStep";
import { SETUP_STEPS, SetupStep } from "./types";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

// Step indicator component
function StepIndicator() {
  const { currentStep } = useSetupWizard();
  const currentIndex = SETUP_STEPS.indexOf(currentStep);

  const stepLabels: Record<SetupStep, string> = {
    welcome: "Welcome",
    platform: "Platform",
    dependencies: "Dependencies",
    configuration: "Configuration",
    completion: "Complete",
  };

  return (
    <div className="flex items-center justify-center gap-2 py-4 px-8">
      {SETUP_STEPS.map((step, index) => {
        const isActive = index === currentIndex;
        const isComplete = index < currentIndex;

        return (
          <div key={step} className="flex items-center">
            {/* Connector line */}
            {index > 0 && (
              <div
                className={cn(
                  "w-8 h-0.5 mr-2",
                  isComplete ? "bg-primary" : "bg-border"
                )}
              />
            )}

            {/* Step circle */}
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors",
                  isActive && "bg-primary text-primary-foreground",
                  isComplete && "bg-primary text-primary-foreground",
                  !isActive && !isComplete && "bg-muted text-muted-foreground"
                )}
              >
                {isComplete ? (
                  <Check className="h-4 w-4" />
                ) : (
                  index + 1
                )}
              </div>
              <span
                className={cn(
                  "text-xs transition-colors hidden sm:block",
                  isActive && "text-foreground font-medium",
                  !isActive && "text-muted-foreground"
                )}
              >
                {stepLabels[step]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Step renderer
function StepContent() {
  const { currentStep, isComplete } = useSetupWizard();

  if (isComplete) {
    // Setup complete - redirect or show success
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] p-8">
        <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
          <Check className="h-8 w-8 text-green-500" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Setup Complete!</h2>
        <p className="text-muted-foreground mb-4">
          Remote Dev is starting up...
        </p>
      </div>
    );
  }

  switch (currentStep) {
    case "welcome":
      return <WelcomeStep />;
    case "platform":
      return <PlatformStep />;
    case "dependencies":
      return <DependenciesStep />;
    case "configuration":
      return <ConfigurationStep />;
    case "completion":
      return <CompletionStep />;
    default:
      return <WelcomeStep />;
  }
}

// Main wizard component (without provider)
function SetupWizardContent() {
  const { currentStep, isComplete } = useSetupWizard();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b">
        <div className="flex items-center justify-center h-14 px-4">
          <h1 className="text-lg font-semibold">Remote Dev Setup</h1>
        </div>
        {!isComplete && currentStep !== "welcome" && <StepIndicator />}
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-4xl">
          <StepContent />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t py-4">
        <div className="text-center text-xs text-muted-foreground">
          Remote Dev v1.0.0
        </div>
      </footer>
    </div>
  );
}

// Exported component with provider
export function SetupWizard() {
  return (
    <SetupWizardProvider>
      <SetupWizardContent />
    </SetupWizardProvider>
  );
}
