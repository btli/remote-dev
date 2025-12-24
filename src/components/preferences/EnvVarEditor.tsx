"use client";

import { useState, useCallback, useEffect } from "react";
import { Plus, Trash2, Ban, RotateCcw, AlertTriangle, Lightbulb } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EnvironmentVariables, ResolvedEnvVar, PortConflict } from "@/types/environment";
import { ENV_VAR_DISABLED, validateEnvVarKey, validateEnvVarValue } from "@/types/environment";

interface EnvVarEditorProps {
  /** Current environment variables for this folder (local overrides) */
  localEnvVars: EnvironmentVariables | null;
  /** Resolved environment from parent folders (for showing inherited values) */
  inheritedEnvVars: ResolvedEnvVar[];
  /** Port conflicts detected */
  portConflicts: PortConflict[];
  /** Callback when environment variables change */
  onChange: (envVars: EnvironmentVariables | null) => void;
  /** Callback to use a suggested port */
  onUseSuggestedPort?: (varName: string, port: number) => void;
}

interface EnvVarRowData {
  key: string;
  value: string;
  isInherited: boolean;
  isDisabled: boolean;
  isOverridden: boolean;
  inheritedValue?: string;
  inheritedSource?: string;
  isNew?: boolean;
}

export function EnvVarEditor({
  localEnvVars,
  inheritedEnvVars,
  portConflicts,
  onChange,
  onUseSuggestedPort,
}: EnvVarEditorProps) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [valueError, setValueError] = useState<string | null>(null);

  // Build the combined list of variables to display
  const buildVarList = useCallback((): EnvVarRowData[] => {
    const rows: EnvVarRowData[] = [];
    const processedKeys = new Set<string>();

    // First, add local variables (overrides and new ones)
    if (localEnvVars) {
      for (const [key, value] of Object.entries(localEnvVars)) {
        const inherited = inheritedEnvVars.find((v) => v.key === key);
        const isDisabled = value === ENV_VAR_DISABLED;

        rows.push({
          key,
          value: isDisabled ? (inherited?.value || "") : value,
          isInherited: false,
          isDisabled,
          isOverridden: !!inherited,
          inheritedValue: inherited?.value,
          inheritedSource: inherited?.source.type === "folder"
            ? inherited.source.folderName
            : inherited?.source.type === "user"
            ? "User settings"
            : undefined,
        });
        processedKeys.add(key);
      }
    }

    // Then, add inherited variables that aren't overridden
    for (const inherited of inheritedEnvVars) {
      if (processedKeys.has(inherited.key)) continue;
      if (inherited.isDisabled) continue;

      rows.push({
        key: inherited.key,
        value: inherited.value,
        isInherited: true,
        isDisabled: false,
        isOverridden: false,
        inheritedSource: inherited.source.type === "folder"
          ? inherited.source.folderName
          : inherited.source.type === "user"
          ? "User settings"
          : undefined,
      });
    }

    // Sort by key
    return rows.sort((a, b) => a.key.localeCompare(b.key));
  }, [localEnvVars, inheritedEnvVars]);

  const varList = buildVarList();

  // Get port conflict for a specific variable
  const getPortConflict = (key: string): PortConflict | undefined => {
    return portConflicts.find((c) => c.variableName === key);
  };

  // Handle adding a new variable
  const handleAdd = () => {
    const keyErr = validateEnvVarKey(newKey);
    if (keyErr) {
      setKeyError(keyErr);
      return;
    }

    const valueErr = validateEnvVarValue(newValue);
    if (valueErr) {
      setValueError(valueErr);
      return;
    }

    // Check if key already exists
    if (localEnvVars?.[newKey] !== undefined || inheritedEnvVars.some((v) => v.key === newKey)) {
      setKeyError("Variable already exists");
      return;
    }

    const updated = { ...localEnvVars, [newKey]: newValue };
    onChange(updated);
    setNewKey("");
    setNewValue("");
    setKeyError(null);
    setValueError(null);
  };

  // Handle updating a variable value
  const handleUpdate = (key: string, value: string) => {
    const updated = { ...localEnvVars, [key]: value };
    onChange(updated);
  };

  // Handle deleting a local variable (or reset override)
  const handleDelete = (key: string) => {
    if (!localEnvVars) return;
    const { [key]: _omitted, ...rest } = localEnvVars;
    void _omitted; // Explicitly mark as intentionally unused
    onChange(Object.keys(rest).length > 0 ? rest : null);
  };

  // Handle disabling an inherited variable
  const handleDisable = (key: string) => {
    const updated = { ...localEnvVars, [key]: ENV_VAR_DISABLED };
    onChange(updated);
  };

  // Handle re-enabling a disabled variable
  const handleEnable = (key: string) => {
    if (!localEnvVars) return;
    const { [key]: _omitted, ...rest } = localEnvVars;
    void _omitted; // Explicitly mark as intentionally unused
    onChange(Object.keys(rest).length > 0 ? rest : null);
  };

  // Validate key as user types
  useEffect(() => {
    if (newKey) {
      const err = validateEnvVarKey(newKey);
      setKeyError(err);
    } else {
      setKeyError(null);
    }
  }, [newKey]);

  return (
    <div className="space-y-3">
      {/* Port Conflict Warnings */}
      {portConflicts.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
          <div className="flex items-center gap-2 text-amber-400">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">Port Conflicts Detected</span>
          </div>
          {portConflicts.map((conflict) => (
            <div key={`${conflict.variableName}-${conflict.port}`} className="text-sm text-slate-300 pl-6">
              <span className="font-mono">{conflict.variableName}={conflict.port}</span>
              {" conflicts with "}
              <span className="text-amber-300">{conflict.conflictingFolder.name}</span>
              {" ("}
              <span className="font-mono">{conflict.conflictingVariableName}</span>
              {")"}
              {conflict.suggestedPort && onUseSuggestedPort && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onUseSuggestedPort(conflict.variableName, conflict.suggestedPort!)}
                  className="ml-2 h-6 px-2 text-xs text-amber-400 hover:text-amber-300"
                >
                  <Lightbulb className="w-3 h-3 mr-1" />
                  Use {conflict.suggestedPort}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Variable List */}
      {varList.length > 0 && (
        <div className="space-y-2">
          {varList.map((row) => {
            const conflict = getPortConflict(row.key);

            return (
              <div
                key={row.key}
                className={cn(
                  "flex items-center gap-2 p-2 rounded-md",
                  row.isDisabled && "opacity-50 bg-slate-800/30",
                  row.isInherited && "bg-slate-800/50",
                  !row.isInherited && !row.isDisabled && "bg-slate-800",
                  conflict && "ring-1 ring-amber-500/50"
                )}
              >
                {/* Key */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "font-mono text-sm",
                      row.isDisabled ? "text-slate-500 line-through" : "text-violet-300"
                    )}>
                      {row.key}
                    </span>
                    {row.isInherited && (
                      <span className="text-xs text-slate-500 truncate">
                        from {row.inheritedSource}
                      </span>
                    )}
                    {row.isOverridden && !row.isDisabled && (
                      <span className="text-xs text-violet-400">overrides</span>
                    )}
                    {row.isDisabled && (
                      <span className="text-xs text-red-400">disabled</span>
                    )}
                  </div>
                </div>

                {/* Value */}
                <div className="flex-1 min-w-0">
                  {row.isInherited ? (
                    <span className="font-mono text-sm text-slate-400 truncate block">
                      {row.value}
                    </span>
                  ) : row.isDisabled ? (
                    <span className="font-mono text-sm text-slate-500 italic">
                      was: {row.inheritedValue}
                    </span>
                  ) : (
                    <Input
                      value={row.value}
                      onChange={(e) => handleUpdate(row.key, e.target.value)}
                      className="h-7 bg-slate-700 border-white/10 text-white font-mono text-sm"
                    />
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  {row.isInherited && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUpdate(row.key, row.value)}
                        className="h-7 w-7 p-0 text-slate-400 hover:text-white"
                        title="Override value"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDisable(row.key)}
                        className="h-7 w-7 p-0 text-slate-400 hover:text-red-400"
                        title="Disable variable"
                      >
                        <Ban className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                  {!row.isInherited && row.isOverridden && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(row.key)}
                      className="h-7 w-7 p-0 text-slate-400 hover:text-amber-400"
                      title="Revert to inherited"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </Button>
                  )}
                  {!row.isInherited && !row.isOverridden && !row.isDisabled && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(row.key)}
                      className="h-7 w-7 p-0 text-slate-400 hover:text-red-400"
                      title="Delete variable"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                  {row.isDisabled && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEnable(row.key)}
                      className="h-7 w-7 p-0 text-slate-400 hover:text-green-400"
                      title="Re-enable variable"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add New Variable */}
      <div className="flex items-start gap-2 pt-2 border-t border-white/5">
        <div className="flex-1 space-y-1">
          <Input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.toUpperCase())}
            placeholder="VARIABLE_NAME"
            className={cn(
              "h-8 bg-slate-800 border-white/10 text-white font-mono text-sm uppercase",
              keyError && "border-red-500/50"
            )}
          />
          {keyError && (
            <p className="text-xs text-red-400">{keyError}</p>
          )}
        </div>
        <div className="flex-1 space-y-1">
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="value"
            className={cn(
              "h-8 bg-slate-800 border-white/10 text-white font-mono text-sm",
              valueError && "border-red-500/50"
            )}
          />
          {valueError && (
            <p className="text-xs text-red-400">{valueError}</p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleAdd}
          disabled={!newKey || !!keyError}
          className="h-8 px-3 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
        >
          <Plus className="w-4 h-4 mr-1" />
          Add
        </Button>
      </div>

      {/* Empty state */}
      {varList.length === 0 && !newKey && (
        <p className="text-sm text-slate-500 text-center py-4">
          No environment variables configured. Add variables to customize the terminal environment.
        </p>
      )}
    </div>
  );
}
