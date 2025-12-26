"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Cpu,
  Plus,
  Loader2,
  FolderOpen,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { usePortContext } from "@/contexts/PortContext";
import { useFolderContext } from "@/contexts/FolderContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import type { DetectedFramework, FrameworkPort } from "@/types/port";

interface FrameworkDetectionTabProps {
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
}

export function FrameworkDetectionTab({
  selectedFolderId,
  onSelectFolder,
}: FrameworkDetectionTabProps) {
  const { folders } = useFolderContext();
  const { frameworks, runtimes, detectFrameworks, detectRuntime, isPortAvailable } =
    usePortContext();
  const { folderPreferences, updateFolderPreferences } = usePreferencesContext();

  const [detecting, setDetecting] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Get current folder's detection results
  const currentFrameworks = selectedFolderId
    ? frameworks.get(selectedFolderId) || []
    : [];
  const currentRuntime = selectedFolderId
    ? runtimes.get(selectedFolderId) || null
    : null;

  // Get working directory for selected folder
  const selectedFolderWorkingDir = useMemo(() => {
    if (!selectedFolderId) return null;
    const prefs = folderPreferences.get(selectedFolderId);
    return prefs?.defaultWorkingDirectory || null;
  }, [selectedFolderId, folderPreferences]);

  // Build folder options
  const folderOptions = useMemo(() => {
    return folders.map((f) => ({
      id: f.id,
      name: f.name,
      hasWorkingDir: !!folderPreferences.get(f.id)?.defaultWorkingDirectory,
    }));
  }, [folders, folderPreferences]);

  // Handle detection
  const handleDetect = useCallback(async () => {
    if (!selectedFolderId || !selectedFolderWorkingDir) {
      setError("Please select a folder with a working directory configured");
      return;
    }

    setDetecting(true);
    setError(null);

    try {
      await Promise.all([
        detectFrameworks(selectedFolderId, selectedFolderWorkingDir),
        detectRuntime(selectedFolderId, selectedFolderWorkingDir),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Detection failed");
    } finally {
      setDetecting(false);
    }
  }, [selectedFolderId, selectedFolderWorkingDir, detectFrameworks, detectRuntime]);

  // Run detection when folder changes
  useEffect(() => {
    if (selectedFolderId && selectedFolderWorkingDir && !frameworks.has(selectedFolderId)) {
      handleDetect();
    }
  }, [selectedFolderId, selectedFolderWorkingDir, frameworks, handleDetect]);

  // Handle adding a port suggestion
  const handleAddPort = useCallback(
    async (framework: DetectedFramework, port: FrameworkPort) => {
      if (!selectedFolderId) return;

      const portKey = `${framework.id}-${port.variableName}`;
      setAdding(portKey);
      setError(null);
      setSuccess(null);

      try {
        // Check port availability
        if (!isPortAvailable(port.defaultPort, selectedFolderId)) {
          setError(`Port ${port.defaultPort} is already allocated to another folder`);
          return;
        }

        // Get current env vars
        const currentPrefs = folderPreferences.get(selectedFolderId);
        const currentEnv = currentPrefs?.environmentVars || {};

        // Add the new port variable
        await updateFolderPreferences(selectedFolderId, {
          environmentVars: {
            ...currentEnv,
            [port.variableName]: port.defaultPort.toString(),
          },
        });

        setSuccess(`Added ${port.variableName}=${port.defaultPort}`);
        setTimeout(() => setSuccess(null), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add port");
      } finally {
        setAdding(null);
      }
    },
    [selectedFolderId, folderPreferences, updateFolderPreferences, isPortAvailable]
  );

  // Check if port is already configured
  const isPortConfigured = useCallback(
    (port: FrameworkPort): boolean => {
      if (!selectedFolderId) return false;
      const prefs = folderPreferences.get(selectedFolderId);
      const env = prefs?.environmentVars || {};
      return port.variableName in env;
    },
    [selectedFolderId, folderPreferences]
  );

  return (
    <div className="space-y-4">
      {/* Folder Selection */}
      <div className="flex items-center gap-3">
        <Select
          value={selectedFolderId || ""}
          onValueChange={(v) => onSelectFolder(v || null)}
        >
          <SelectTrigger className="flex-1 bg-slate-800 border-white/10 text-white text-xs">
            <SelectValue placeholder="Select a folder to detect frameworks" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-white/10">
            {folderOptions.map((folder) => (
              <SelectItem
                key={folder.id}
                value={folder.id}
                className="text-white text-xs"
                disabled={!folder.hasWorkingDir}
              >
                <span className="flex items-center gap-2">
                  <FolderOpen className="w-3.5 h-3.5" />
                  {folder.name}
                  {!folder.hasWorkingDir && (
                    <span className="text-slate-500">(no working dir)</span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          onClick={handleDetect}
          disabled={!selectedFolderId || !selectedFolderWorkingDir || detecting}
          className="bg-violet-600 hover:bg-violet-700 text-white"
        >
          {detecting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <Cpu className="w-4 h-4 mr-1" />
              Detect
            </>
          )}
        </Button>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {success && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
          <CheckCircle className="w-4 h-4" />
          {success}
        </div>
      )}

      {/* Runtime Detection */}
      {currentRuntime && currentRuntime.id !== "unknown" && (
        <div className="p-3 rounded-lg bg-slate-800/30 border border-white/5">
          <div className="text-xs text-slate-400 mb-1">Detected Runtime</div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="bg-violet-500/10 text-violet-400 border-violet-500/30"
            >
              {currentRuntime.name}
            </Badge>
            {currentRuntime.lockfile && (
              <span className="text-xs text-slate-500">
                via {currentRuntime.lockfile}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Detected Frameworks */}
      {!selectedFolderId ? (
        <div className="text-center py-12 text-slate-400">
          <Cpu className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-xs">Select a folder to detect frameworks</p>
        </div>
      ) : !selectedFolderWorkingDir ? (
        <div className="text-center py-12 text-slate-400">
          <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-xs">Configure a working directory first</p>
          <p className="text-xs mt-1">
            Go to folder preferences to set a working directory
          </p>
        </div>
      ) : detecting ? (
        <div className="text-center py-12 text-slate-400">
          <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-violet-400" />
          <p className="text-xs">Detecting frameworks...</p>
        </div>
      ) : currentFrameworks.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Cpu className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-xs">No frameworks detected</p>
          <p className="text-xs mt-1">
            Click Detect to scan the project directory
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-slate-400">Detected Frameworks</div>
          {currentFrameworks.map((framework) => (
            <FrameworkCard
              key={framework.id}
              framework={framework}
              adding={adding}
              onAddPort={(port) => handleAddPort(framework, port)}
              isPortConfigured={isPortConfigured}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Framework Card
// ============================================================================

interface FrameworkCardProps {
  framework: DetectedFramework;
  adding: string | null;
  onAddPort: (port: FrameworkPort) => void;
  isPortConfigured: (port: FrameworkPort) => boolean;
}

function FrameworkCard({
  framework,
  adding,
  onAddPort,
  isPortConfigured,
}: FrameworkCardProps) {
  const confidenceColors = {
    high: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    medium: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    low: "bg-slate-500/10 text-slate-400 border-slate-500/30",
  };

  return (
    <div className="p-4 rounded-lg bg-slate-800/30 border border-white/5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white text-xs">{framework.name}</span>
          <Badge
            variant="outline"
            className={`text-[10px] ${confidenceColors[framework.confidence]}`}
          >
            {framework.confidence}
          </Badge>
        </div>
        {framework.configPath && (
          <span className="text-[10px] text-slate-500 font-mono">
            {framework.configPath}
          </span>
        )}
      </div>

      {/* Suggested Ports */}
      <div className="space-y-2">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Suggested Ports
        </div>
        {framework.suggestedPorts.map((port) => {
          const configured = isPortConfigured(port);
          const portKey = `${framework.id}-${port.variableName}`;
          const isAdding = adding === portKey;

          return (
            <div
              key={port.variableName}
              className="flex items-center justify-between p-2 rounded bg-slate-800/50"
            >
              <div className="flex items-center gap-3">
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] bg-slate-800/50 text-slate-300 border-slate-700"
                >
                  {port.variableName}
                </Badge>
                <span className="text-xs text-slate-400">
                  {port.defaultPort}
                </span>
                <span className="text-[10px] text-slate-500">
                  {port.description}
                </span>
              </div>

              {configured ? (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                >
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Configured
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onAddPort(port)}
                  disabled={isAdding}
                  className="h-6 text-xs text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
                >
                  {isAdding ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <>
                      <Plus className="w-3 h-3 mr-1" />
                      Add
                    </>
                  )}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
