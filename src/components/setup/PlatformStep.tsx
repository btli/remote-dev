"use client";

/**
 * Platform Step
 *
 * Detects and displays platform information, including WSL on Windows.
 */

import { useEffect } from "react";
import { useSetupWizard } from "./SetupWizardContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Laptop,
  Check,
  AlertCircle,
  Loader2,
  Package,
  Terminal,
  RefreshCw,
} from "lucide-react";

const OS_NAMES: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

const ARCH_NAMES: Record<string, string> = {
  x64: "64-bit (x64)",
  arm64: "Apple Silicon (ARM64)",
  arm: "ARM",
};

export function PlatformStep() {
  const {
    platform,
    configuration,
    isLoading,
    error,
    detectPlatform,
    selectWslDistro,
    nextStep,
    prevStep,
    canProceed,
  } = useSetupWizard();

  // Auto-detect on mount
  useEffect(() => {
    if (!platform) {
      detectPlatform();
    }
  }, [platform, detectPlatform]);

  return (
    <div className="flex flex-col min-h-[500px] p-8">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Platform Detection</h2>
        <p className="text-muted-foreground">
          We&apos;ll detect your operating system and available tools.
        </p>
      </div>

      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground">Detecting platform...</p>
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Detection Failed</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={detectPlatform}
              className="ml-4"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {platform && !isLoading && (
        <div className="flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {/* Operating System */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Laptop className="h-5 w-5" />
                  Operating System
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-medium">
                    {OS_NAMES[platform.os] || platform.os}
                  </span>
                  <Badge variant="secondary">
                    {ARCH_NAMES[platform.arch] || platform.arch}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Shell */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Terminal className="h-5 w-5" />
                  Default Shell
                </CardTitle>
              </CardHeader>
              <CardContent>
                <span className="text-lg font-mono">{platform.shell}</span>
              </CardContent>
            </Card>

            {/* Package Manager */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-5 w-5" />
                  Package Manager
                </CardTitle>
              </CardHeader>
              <CardContent>
                {platform.packageManager ? (
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    <span className="text-lg font-mono">
                      {platform.packageManager}
                    </span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">Not detected</span>
                )}
              </CardContent>
            </Card>

            {/* WSL (Windows only) */}
            {platform.os === "win32" && (
              <Card className="md:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Terminal className="h-5 w-5" />
                    Windows Subsystem for Linux (WSL)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {platform.isWSL && platform.wslDistros && platform.wslDistros.length > 0 ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-500" />
                        <span>WSL is installed with {platform.wslDistros.length} distribution(s)</span>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-2 block">
                          Select WSL Distribution
                        </label>
                        <Select
                          value={configuration.wslDistribution}
                          onValueChange={selectWslDistro}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select a distribution" />
                          </SelectTrigger>
                          <SelectContent>
                            {platform.wslDistros.map((distro) => (
                              <SelectItem key={distro.name} value={distro.name}>
                                <div className="flex items-center gap-2">
                                  <span>{distro.name}</span>
                                  {distro.isDefault && (
                                    <Badge variant="outline" className="text-xs">
                                      Default
                                    </Badge>
                                  )}
                                  <Badge
                                    variant={
                                      distro.state === "Running"
                                        ? "default"
                                        : "secondary"
                                    }
                                    className="text-xs"
                                  >
                                    {distro.state}
                                  </Badge>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>WSL Required</AlertTitle>
                      <AlertDescription>
                        Remote Dev requires WSL on Windows for tmux support.
                        Please install WSL first:
                        <pre className="mt-2 p-2 bg-black/20 rounded text-sm">
                          wsl --install
                        </pre>
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
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
