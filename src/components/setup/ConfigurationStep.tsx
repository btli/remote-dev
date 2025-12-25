"use client";

/**
 * Configuration Step
 *
 * Allows users to configure ports and working directory.
 */

import { useState } from "react";
import { useSetupWizard } from "./SetupWizardContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Folder, Globe, Terminal, RefreshCw, AlertCircle } from "lucide-react";

// Helper to get electron API if available
function getElectronSelectDirectory(): (() => Promise<string | null>) | null {
  if (typeof window !== "undefined" && "electron" in window) {
    const electron = window.electron as unknown as {
      selectDirectory: () => Promise<string | null>;
    };
    return electron.selectDirectory;
  }
  return null;
}

export function ConfigurationStep() {
  const {
    configuration,
    platform,
    error,
    updateConfiguration,
    validateConfiguration,
    nextStep,
    prevStep,
  } = useSetupWizard();

  const [validationError, setValidationError] = useState<string | null>(null);

  const handleContinue = async () => {
    setValidationError(null);
    const isValid = await validateConfiguration();
    if (isValid) {
      nextStep();
    } else {
      setValidationError(error || "Invalid configuration");
    }
  };

  const handleBrowseDirectory = async () => {
    const selectDirectory = getElectronSelectDirectory();
    if (selectDirectory) {
      const directory = await selectDirectory();
      if (directory) {
        updateConfiguration({ workingDirectory: directory });
      }
    }
  };

  return (
    <div className="flex flex-col min-h-[500px] p-8">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Configuration</h2>
        <p className="text-muted-foreground">
          Customize Remote Dev to your preferences.
        </p>
      </div>

      {(error || validationError) && (
        <Alert variant="destructive" className="mb-4 max-w-2xl mx-auto">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Configuration Error</AlertTitle>
          <AlertDescription>{error || validationError}</AlertDescription>
        </Alert>
      )}

      <div className="flex-1 max-w-2xl mx-auto w-full space-y-6">
        {/* Working Directory */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Folder className="h-5 w-5" />
              Working Directory
            </CardTitle>
            <CardDescription>
              Default directory for new terminal sessions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                value={configuration.workingDirectory}
                onChange={(e) =>
                  updateConfiguration({ workingDirectory: e.target.value })
                }
                placeholder={platform?.homeDirectory || "/home/user"}
                className="flex-1 font-mono"
              />
              <Button
                variant="outline"
                onClick={handleBrowseDirectory}
                title="Browse..."
              >
                <Folder className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Ports */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-5 w-5" />
              Server Ports
            </CardTitle>
            <CardDescription>
              Ports for the web interface and terminal server
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nextPort">Web Interface (Next.js)</Label>
                <Input
                  id="nextPort"
                  type="number"
                  min={1024}
                  max={65535}
                  value={configuration.nextPort}
                  onChange={(e) =>
                    updateConfiguration({ nextPort: parseInt(e.target.value) || 3000 })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="terminalPort">Terminal Server</Label>
                <Input
                  id="terminalPort"
                  type="number"
                  min={1024}
                  max={65535}
                  value={configuration.terminalPort}
                  onChange={(e) =>
                    updateConfiguration({ terminalPort: parseInt(e.target.value) || 3001 })
                  }
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Ports must be between 1024 and 65535, and different from each other.
            </p>
          </CardContent>
        </Card>

        {/* Auto Start */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Terminal className="h-5 w-5" />
              Startup Options
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="autoStart">Start servers on launch</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically start Next.js and terminal servers when app opens
                </p>
              </div>
              <Switch
                id="autoStart"
                checked={configuration.autoStart}
                onCheckedChange={(checked) =>
                  updateConfiguration({ autoStart: checked })
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="checkUpdates" className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Check for updates
                </Label>
                <p className="text-sm text-muted-foreground">
                  Notify when new versions are available
                </p>
              </div>
              <Switch
                id="checkUpdates"
                checked={configuration.checkForUpdates}
                onCheckedChange={(checked) =>
                  updateConfiguration({ checkForUpdates: checked })
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Navigation */}
      <div className="flex justify-between mt-8">
        <Button variant="outline" onClick={prevStep}>
          Back
        </Button>
        <Button onClick={handleContinue}>Continue</Button>
      </div>
    </div>
  );
}
