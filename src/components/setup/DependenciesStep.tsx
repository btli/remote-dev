"use client";

/**
 * Dependencies Step
 *
 * Checks and optionally installs required dependencies.
 */

import { useEffect } from "react";
import { useSetupWizard } from "./SetupWizardContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Check,
  X,
  AlertCircle,
  Loader2,
  RefreshCw,
  ExternalLink,
  Package,
  Copy,
} from "lucide-react";
import { DependencyStatus } from "./types";

function DependencyCard({
  dependency,
  onInstall,
}: {
  dependency: DependencyStatus;
  onInstall: () => void;
}) {
  const copyCommand = async (command: string) => {
    await navigator.clipboard.writeText(command);
  };

  return (
    <Card
      className={
        dependency.installed
          ? "border-green-500/30 bg-green-500/5"
          : dependency.required
            ? "border-red-500/30 bg-red-500/5"
            : "border-yellow-500/30 bg-yellow-500/5"
      }
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {dependency.displayName}
            {dependency.required && (
              <Badge variant="destructive" className="text-xs">
                Required
              </Badge>
            )}
          </div>
          <StatusIcon status={dependency.status} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {dependency.installed && dependency.version && (
            <p className="text-sm text-muted-foreground">
              Version: {dependency.version}
            </p>
          )}

          {dependency.status === "installing" && (
            <div className="space-y-2">
              <Progress value={undefined} className="h-2" />
              <p className="text-sm text-muted-foreground">Installing...</p>
            </div>
          )}

          {dependency.status === "error" && dependency.error && (
            <Alert variant="destructive" className="py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                {dependency.error}
              </AlertDescription>
            </Alert>
          )}

          {!dependency.installed && dependency.status !== "installing" && (
            <div className="space-y-2">
              {dependency.installCommand && (
                <div className="flex items-center gap-2 p-2 bg-black/20 rounded">
                  <code className="flex-1 text-xs font-mono overflow-x-auto">
                    {dependency.installCommand}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyCommand(dependency.installCommand!)}
                    className="h-6 w-6 p-0"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={onInstall}>
                  Auto Install
                </Button>
                {dependency.downloadUrl && (
                  <Button size="sm" variant="ghost" asChild>
                    <a
                      href={dependency.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4 mr-1" />
                      Manual Install
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusIcon({ status }: { status: DependencyStatus["status"] }) {
  switch (status) {
    case "checking":
      return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
    case "installed":
      return <Check className="h-5 w-5 text-green-500" />;
    case "missing":
      return <X className="h-5 w-5 text-red-500" />;
    case "installing":
      return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
    case "error":
      return <AlertCircle className="h-5 w-5 text-red-500" />;
  }
}

export function DependenciesStep() {
  const {
    dependencies,
    isLoading,
    error,
    checkDependencies,
    installDependency,
    nextStep,
    prevStep,
    canProceed,
  } = useSetupWizard();

  // Auto-check on mount
  useEffect(() => {
    if (dependencies.length === 0) {
      checkDependencies();
    }
  }, [dependencies.length, checkDependencies]);

  const installedCount = dependencies.filter((d) => d.installed).length;
  const requiredMissing = dependencies.filter(
    (d) => d.required && !d.installed
  );
  const optionalMissing = dependencies.filter(
    (d) => !d.required && !d.installed
  );

  return (
    <div className="flex flex-col min-h-[500px] p-8">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Dependencies</h2>
        <p className="text-muted-foreground">
          Remote Dev requires a few tools to work properly.
        </p>
      </div>

      {isLoading && dependencies.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground">Checking dependencies...</p>
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Check Failed</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={checkDependencies}
              className="ml-4"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {dependencies.length > 0 && (
        <div className="flex-1">
          {/* Summary */}
          <div className="flex items-center justify-between mb-4 max-w-2xl mx-auto">
            <div className="flex items-center gap-2">
              <Progress
                value={(installedCount / dependencies.length) * 100}
                className="w-32 h-2"
              />
              <span className="text-sm text-muted-foreground">
                {installedCount} of {dependencies.length} installed
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={checkDependencies}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Re-check
            </Button>
          </div>

          {/* Required dependencies */}
          {requiredMissing.length > 0 && (
            <Alert variant="destructive" className="mb-4 max-w-2xl mx-auto">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Required Dependencies Missing</AlertTitle>
              <AlertDescription>
                {requiredMissing.map((d) => d.displayName).join(", ")} must be
                installed to continue.
              </AlertDescription>
            </Alert>
          )}

          {/* Dependency cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {dependencies.map((dep) => (
              <DependencyCard
                key={dep.name}
                dependency={dep}
                onInstall={() => installDependency(dep.name)}
              />
            ))}
          </div>

          {/* Optional dependencies info */}
          {optionalMissing.length > 0 && canProceed() && (
            <Alert className="mt-4 max-w-2xl mx-auto">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Optional Dependencies</AlertTitle>
              <AlertDescription>
                Some optional dependencies are missing. You can install them
                later for additional features.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-8">
        <Button variant="outline" onClick={prevStep}>
          Back
        </Button>
        <Button onClick={nextStep} disabled={!canProceed()}>
          Continue
        </Button>
      </div>
    </div>
  );
}
