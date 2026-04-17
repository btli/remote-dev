"use client";

/**
 * SecretsSection - Secrets management for the full-page settings view.
 *
 * Contains all the logic and UI from SecretsConfigModal but without the
 * Dialog/DialogContent wrapper so it can be embedded directly in a page.
 */

import { useState, useMemo } from "react";
import {
  Check,
  X,
  Loader2,
  Plus,
  Settings2,
  Trash2,
  FolderClosed,
  Shield,
  AlertCircle,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSecretsContext } from "@/contexts/SecretsContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useFolderContext } from "@/contexts/FolderContext";
import {
  SUPPORTED_SECRETS_PROVIDERS,
  getProviderInfo,
  type SecretsProviderType,
  type SecretsValidationResult,
} from "@/types/secrets";
import { cn } from "@/lib/utils";

export function SecretsSection() {
  const { activeProject } = usePreferencesContext();
  const { folders } = useFolderContext();
  const {
    folderConfigs,
    getConfigForFolder,
    updateConfig,
    deleteConfig,
    testConnection,
    loading,
  } = useSecretsContext();

  // Editing state
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [provider, setProvider] = useState<SecretsProviderType>("phase");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SecretsValidationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active tab - always starts with overview
  const [activeTab, setActiveTab] = useState<"overview" | "configure">("overview");

  // Get folders that can be configured (all folders for now)
  const availableFolders = useMemo(() => {
    return [...folders].sort((a, b) => a.name.localeCompare(b.name));
  }, [folders]);

  // Get folders with existing configs
  const configuredFolders = useMemo(() => {
    return availableFolders.filter((f) => folderConfigs.has(f.id));
  }, [availableFolders, folderConfigs]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const result = await testConnection(provider, config);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        valid: false,
        error: err instanceof Error ? err.message : "Test failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!selectedFolderId) return;

    setSaving(true);
    setError(null);

    try {
      await updateConfig(selectedFolderId, {
        provider,
        config,
        enabled,
      });
      setActiveTab("overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedFolderId) return;

    setSaving(true);
    setError(null);

    try {
      await deleteConfig(selectedFolderId);
      setSelectedFolderId(null);
      setActiveTab("overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setSaving(false);
    }
  };

  const loadFolderConfig = (folderId: string) => {
    setSelectedFolderId(folderId);
    const existingConfig = getConfigForFolder(folderId);
    if (existingConfig) {
      setProvider(existingConfig.provider);
      setConfig(existingConfig.providerConfig);
      setEnabled(existingConfig.enabled);
    } else {
      setProvider("phase");
      setConfig({ app: "", env: "development", serviceToken: "" });
      setEnabled(true);
    }
    setTestResult(null);
    setError(null);
  };

  const handleConfigureFolder = (folderId: string) => {
    loadFolderConfig(folderId);
    setActiveTab("configure");
  };

  const providerInfo = getProviderInfo(provider);

  // Check that all required provider fields are filled
  const canSubmit = providerInfo?.configFields
    .filter((f) => f.required)
    .every((f) => !!config[f.key]) ?? false;

  return (
    <div className="h-full flex flex-col">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "overview" | "configure")}
        className="flex-1 min-h-0 flex flex-col"
      >
        <TabsList className="w-full bg-muted/50 flex-shrink-0">
          <TabsTrigger value="overview" className="flex-1 gap-1.5 text-xs">
            <FolderClosed className="w-3.5 h-3.5" />
            Overview
            {configuredFolders.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-primary/20 text-primary/80">
                {configuredFolders.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="configure" className="flex-1 gap-1.5 text-xs">
            <Settings2 className="w-3.5 h-3.5" />
            Configure
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto min-h-0 py-4">
          {/* Overview Tab */}
          <TabsContent value="overview" className="mt-0 space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : configuredFolders.length === 0 ? (
              <div className="text-center py-8">
                <Shield className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground mb-4">
                  No secrets providers configured yet.
                </p>
                {availableFolders.length > 0 ? (
                  <Button
                    onClick={() => {
                      const defaultFolderId =
                        activeProject.folderId || availableFolders[0]?.id || null;
                      if (defaultFolderId) {
                        handleConfigureFolder(defaultFolderId);
                      } else {
                        setActiveTab("configure");
                      }
                    }}
                    className="bg-primary hover:bg-primary/90"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Provider
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground/70">
                    Create a folder first to configure secrets.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {configuredFolders.map((folder) => {
                  const folderConfig = folderConfigs.get(folder.id);
                  if (!folderConfig) return null;

                  const info = getProviderInfo(folderConfig.provider);

                  return (
                    <div
                      key={folder.id}
                      className={cn(
                        "p-3 rounded-lg border transition-colors cursor-pointer",
                        "hover:border-primary/50 hover:bg-muted/50",
                        folderConfig.enabled
                          ? "border-border bg-card/30"
                          : "border-border/50 bg-card/20 opacity-60"
                      )}
                      onClick={() => handleConfigureFolder(folder.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <FolderClosed className="w-4 h-4 text-primary" />
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {folder.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {info?.name || folderConfig.provider}
                              {folderConfig.providerConfig.env && (
                                <span className="ml-1 text-muted-foreground/70">
                                  ({folderConfig.providerConfig.env})
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {folderConfig.enabled ? (
                            <span className="text-xs text-green-400 flex items-center gap-1">
                              <Check className="w-3 h-3" />
                              Active
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/70">Disabled</span>
                          )}
                        </div>
                      </div>
                      {folderConfig.lastFetchedAt && (
                        <p className="text-xs text-muted-foreground/70 mt-2">
                          Last fetched:{" "}
                          {new Date(folderConfig.lastFetchedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  );
                })}

                {/* Add more button */}
                {availableFolders.length > configuredFolders.length && (
                  <Button
                    variant="ghost"
                    className="w-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/50"
                    onClick={() => {
                      // Find first unconfigured folder
                      const unconfigured = availableFolders.find(
                        (f) => !folderConfigs.has(f.id)
                      );
                      if (unconfigured) {
                        handleConfigureFolder(unconfigured.id);
                      }
                    }}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Another Folder
                  </Button>
                )}
              </div>
            )}
          </TabsContent>

          {/* Configure Tab */}
          <TabsContent value="configure" className="mt-0 space-y-4">
            {/* Folder Selection */}
            <div className="space-y-2">
              <Label className="text-muted-foreground">Folder</Label>
              <Select
                value={selectedFolderId || ""}
                onValueChange={loadFolderConfig}
              >
                <SelectTrigger className="bg-card border-border text-foreground">
                  <SelectValue placeholder="Select a folder..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {availableFolders.map((folder) => (
                    <SelectItem
                      key={folder.id}
                      value={folder.id}
                      className="text-foreground focus:bg-primary/20"
                    >
                      <div className="flex items-center gap-2">
                        <FolderClosed className="w-3.5 h-3.5 text-primary" />
                        {folder.name}
                        {folderConfigs.has(folder.id) && (
                          <span className="text-xs text-green-400">(configured)</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedFolderId && (
              <>
                {/* Provider Selection */}
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Provider</Label>
                  <Select
                    value={provider}
                    onValueChange={(v) => {
                      setProvider(v as SecretsProviderType);
                      setConfig({});
                      setTestResult(null);
                    }}
                  >
                    <SelectTrigger className="bg-card border-border text-foreground">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {SUPPORTED_SECRETS_PROVIDERS.map((p) => (
                        <SelectItem
                          key={p.type}
                          value={p.type}
                          className="text-foreground focus:bg-primary/20"
                        >
                          <div className="flex flex-col">
                            <span>{p.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {p.description}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Provider-specific config fields */}
                {providerInfo?.configFields.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <Label className="text-muted-foreground">
                      {field.label}
                      {field.required && (
                        <span className="text-red-400 ml-1">*</span>
                      )}
                    </Label>
                    {field.type === "select" ? (
                      <Select
                        value={config[field.key] || ""}
                        onValueChange={(v) =>
                          setConfig((prev) => ({ ...prev, [field.key]: v }))
                        }
                      >
                        <SelectTrigger className="bg-card border-border text-foreground">
                          <SelectValue placeholder={`Select ${field.label}...`} />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          {field.options?.map((option) => (
                            <SelectItem
                              key={option.value}
                              value={option.value}
                              className="text-foreground focus:bg-primary/20"
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={field.type}
                        value={config[field.key] || ""}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                        placeholder={field.placeholder}
                        className="bg-card border-border text-foreground"
                      />
                    )}
                    {field.helpText && (
                      <p className="text-xs text-muted-foreground/70">{field.helpText}</p>
                    )}
                  </div>
                ))}

                {/* Test Connection */}
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={handleTest}
                    disabled={testing || !canSubmit}
                    className="border-border text-muted-foreground hover:text-foreground"
                  >
                    {testing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      "Test Connection"
                    )}
                  </Button>

                  {testResult && (
                    <div className="flex items-center gap-2">
                      {testResult.valid ? (
                        <>
                          <Check className="w-4 h-4 text-green-400" />
                          <span className="text-sm text-green-400">
                            Valid
                            {testResult.secretCount !== undefined && (
                              <span className="text-muted-foreground ml-1">
                                ({testResult.secretCount} secrets)
                              </span>
                            )}
                          </span>
                        </>
                      ) : (
                        <>
                          <X className="w-4 h-4 text-red-400" />
                          <span className="text-sm text-red-400">
                            {testResult.error || "Invalid"}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Enable/Disable */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
                  <div>
                    <Label className="text-muted-foreground">Enable secrets injection</Label>
                    <p className="text-xs text-muted-foreground/70">
                      When enabled, secrets are fetched on session creation
                    </p>
                  </div>
                  <Switch checked={enabled} onCheckedChange={setEnabled} />
                </div>

                {/* Error display */}
                {error && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <div className="flex items-center gap-2 text-red-400">
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-sm">{error}</span>
                    </div>
                  </div>
                )}

                {/* Footer actions inline with configure form */}
                <div className="flex justify-between pt-4 border-t border-border">
                  {folderConfigs.has(selectedFolderId) ? (
                    <Button
                      variant="ghost"
                      onClick={handleDelete}
                      disabled={saving}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Remove
                    </Button>
                  ) : (
                    <div />
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => setActiveTab("overview")}
                      className="text-muted-foreground"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={saving || !canSubmit}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        "Save Configuration"
                      )}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
