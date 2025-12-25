"use client";

/**
 * Completion Step
 *
 * Final step showing summary and launch button.
 */

import { useSetupWizard } from "./SetupWizardContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  Loader2,
  AlertCircle,
  Terminal,
  Folder,
  Globe,
  RefreshCw,
  Rocket,
} from "lucide-react";

export function CompletionStep() {
  const {
    platform,
    dependencies,
    configuration,
    isLoading,
    error,
    completeSetup,
    prevStep,
  } = useSetupWizard();

  const installedDeps = dependencies.filter((d) => d.installed);

  return (
    <div className="flex flex-col min-h-[500px] p-8">
      <div className="text-center mb-8">
        <div className="flex items-center justify-center mb-4">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Check className="h-8 w-8 text-primary" />
          </div>
        </div>
        <h2 className="text-2xl font-bold mb-2">Ready to Launch!</h2>
        <p className="text-muted-foreground">
          Here&apos;s a summary of your configuration.
        </p>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4 max-w-2xl mx-auto">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex-1 max-w-2xl mx-auto w-full space-y-4">
        {/* Platform */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Terminal className="h-5 w-5" />
              Platform
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span>
                {platform?.os === "darwin"
                  ? "macOS"
                  : platform?.os === "linux"
                    ? "Linux"
                    : "Windows"}
              </span>
              <Badge variant="secondary">{platform?.arch}</Badge>
              {platform?.os === "win32" && configuration.wslDistribution && (
                <Badge variant="outline">
                  WSL: {configuration.wslDistribution}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Dependencies */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Check className="h-5 w-5 text-green-500" />
              Dependencies ({installedDeps.length} installed)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {dependencies.map((dep) => (
                <Badge
                  key={dep.name}
                  variant={dep.installed ? "default" : "secondary"}
                  className="gap-1"
                >
                  {dep.installed ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <AlertCircle className="h-3 w-3" />
                  )}
                  {dep.displayName}
                  {dep.version && (
                    <span className="text-xs opacity-70">v{dep.version}</span>
                  )}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Configuration */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Folder className="h-5 w-5" />
              Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Folder className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Working Directory:</span>
                <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                  {configuration.workingDirectory}
                </code>
              </div>
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Ports:</span>
                <span>
                  {configuration.nextPort} (web), {configuration.terminalPort} (terminal)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Auto-start:</span>
                <span>{configuration.autoStart ? "Enabled" : "Disabled"}</span>
              </div>
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Update checks:</span>
                <span>{configuration.checkForUpdates ? "Enabled" : "Disabled"}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex flex-col items-center gap-4 mt-8">
        <Button
          size="lg"
          onClick={completeSetup}
          disabled={isLoading}
          className="min-w-[200px]"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Rocket className="h-4 w-4 mr-2" />
              Launch Remote Dev
            </>
          )}
        </Button>
        <Button variant="ghost" size="sm" onClick={prevStep} disabled={isLoading}>
          Go Back
        </Button>
      </div>
    </div>
  );
}
