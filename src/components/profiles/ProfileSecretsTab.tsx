"use client";

import { useState, useEffect, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Save,
  KeyRound,
  CheckCircle,
  XCircle,
  Trash2,
  TestTube2,
} from "lucide-react";
import { useProfileContext } from "@/contexts/ProfileContext";
import type { ProfileSecretsProviderType, ProfileSecretsConfig } from "@/types/agent";

interface ProfileSecretsTabProps {
  profileId: string;
}

const PROVIDER_OPTIONS: { value: ProfileSecretsProviderType; label: string; available: boolean }[] = [
  { value: "phase", label: "Phase", available: true },
  { value: "vault", label: "HashiCorp Vault", available: false },
  { value: "aws-secrets-manager", label: "AWS Secrets Manager", available: false },
  { value: "1password", label: "1Password", available: false },
];

export function ProfileSecretsTab({ profileId }: ProfileSecretsTabProps) {
  const { getSecretsConfig, setSecretsConfig, deleteSecretsConfig, toggleSecretsEnabled } =
    useProfileContext();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ valid: boolean; message?: string } | null>(null);

  // Current config from server
  const [config, setConfig] = useState<ProfileSecretsConfig | null>(null);

  // Form state
  const [provider, setProvider] = useState<ProfileSecretsProviderType>("phase");
  const [enabled, setEnabled] = useState(true);
  const [phaseEnv, setPhaseEnv] = useState("");
  const [phaseAppName, setPhaseAppName] = useState("");
  const [phaseAppSecret, setPhaseAppSecret] = useState("");

  // Load config on mount
  useEffect(() => {
    let mounted = true;

    const loadConfig = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await getSecretsConfig(profileId);
        if (mounted) {
          setConfig(result);
          if (result) {
            setProvider(result.provider);
            setEnabled(result.enabled);
            // Load Phase-specific config
            if (result.provider === "phase" && result.providerConfig) {
              setPhaseEnv(result.providerConfig.environment || "");
              setPhaseAppName(result.providerConfig.appName || "");
              setPhaseAppSecret(result.providerConfig.appSecret || "");
            }
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load secrets config");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadConfig();

    return () => {
      mounted = false;
    };
  }, [profileId, getSecretsConfig]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setTestResult(null);

    try {
      let providerConfig: Record<string, string> = {};
      if (provider === "phase") {
        providerConfig = {
          environment: phaseEnv,
          appName: phaseAppName,
          appSecret: phaseAppSecret,
        };
      }

      const result = await setSecretsConfig(profileId, {
        provider,
        config: providerConfig,
        enabled,
      });

      setConfig(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save secrets config");
    } finally {
      setSaving(false);
    }
  }, [profileId, provider, enabled, phaseEnv, phaseAppName, phaseAppSecret, setSecretsConfig]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);

    try {
      await deleteSecretsConfig(profileId);
      setConfig(null);
      setProvider("phase");
      setEnabled(true);
      setPhaseEnv("");
      setPhaseAppName("");
      setPhaseAppSecret("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete secrets config");
    } finally {
      setDeleting(false);
    }
  }, [profileId, deleteSecretsConfig]);

  const handleToggleEnabled = useCallback(
    async (newEnabled: boolean) => {
      if (!config) return;

      try {
        await toggleSecretsEnabled(profileId, newEnabled);
        setEnabled(newEnabled);
        setConfig((prev) => (prev ? { ...prev, enabled: newEnabled } : null));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to toggle enabled state");
      }
    },
    [profileId, config, toggleSecretsEnabled]
  );

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const response = await fetch("/api/secrets/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          config: {
            environment: phaseEnv,
            appName: phaseAppName,
            appSecret: phaseAppSecret,
          },
        }),
      });

      const result = await response.json();
      setTestResult({
        valid: result.valid,
        message: result.valid ? "Connection successful" : result.error,
      });
    } catch (err) {
      setTestResult({
        valid: false,
        message: err instanceof Error ? err.message : "Test failed",
      });
    } finally {
      setTesting(false);
    }
  }, [provider, phaseEnv, phaseAppName, phaseAppSecret]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <KeyRound className="w-4 h-4" />
          <span>Configure secrets provider for this profile</span>
        </div>
        {config && (
          <Badge
            variant="outline"
            className={
              config.enabled
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-muted/50 text-muted-foreground border-border"
            }
          >
            {config.enabled ? "Enabled" : "Disabled"}
          </Badge>
        )}
      </div>

      {/* Provider Selection */}
      <div className="space-y-2">
        <Label className="text-muted-foreground">Secrets Provider</Label>
        <Select
          value={provider}
          onValueChange={(v) => setProvider(v as ProfileSecretsProviderType)}
        >
          <SelectTrigger className="bg-card border-border text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            {PROVIDER_OPTIONS.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={!option.available}
                className="text-foreground focus:bg-primary/20"
              >
                <span className="flex items-center gap-2">
                  {option.label}
                  {!option.available && (
                    <span className="text-xs text-muted-foreground/70">(Coming soon)</span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Phase Configuration */}
      {provider === "phase" && (
        <div className="space-y-4 p-4 rounded-lg bg-card/30 border border-border">
          <div className="space-y-2">
            <Label htmlFor="phase-env" className="text-muted-foreground">
              Environment
            </Label>
            <Input
              id="phase-env"
              value={phaseEnv}
              onChange={(e) => setPhaseEnv(e.target.value)}
              placeholder="development"
              className="bg-card border-border text-foreground placeholder:text-muted-foreground/70"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phase-app" className="text-muted-foreground">
              App Name
            </Label>
            <Input
              id="phase-app"
              value={phaseAppName}
              onChange={(e) => setPhaseAppName(e.target.value)}
              placeholder="my-app"
              className="bg-card border-border text-foreground placeholder:text-muted-foreground/70"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phase-secret" className="text-muted-foreground">
              App Secret
            </Label>
            <Input
              id="phase-secret"
              type="password"
              value={phaseAppSecret}
              onChange={(e) => setPhaseAppSecret(e.target.value)}
              placeholder="pss_service:v1:..."
              className="bg-card border-border text-foreground placeholder:text-muted-foreground/70"
            />
            <p className="text-xs text-muted-foreground/70">
              Service token from Phase console
            </p>
          </div>

          {/* Test Connection */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testing || !phaseEnv || !phaseAppName || !phaseAppSecret}
              className="border-border text-muted-foreground hover:bg-accent"
            >
              {testing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <TestTube2 className="w-4 h-4 mr-2" />
              )}
              Test Connection
            </Button>

            {testResult && (
              <span
                className={`flex items-center gap-1 text-sm ${
                  testResult.valid ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {testResult.valid ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                {testResult.message}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Enable/Disable Toggle (only when config exists) */}
      {config && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
          <div className="space-y-0.5">
            <Label className="text-muted-foreground">Inject Secrets</Label>
            <p className="text-xs text-muted-foreground/70">
              Inject secrets as environment variables in sessions
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={handleToggleEnabled} />
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between pt-2">
        <div>
          {config && (
            <Button
              variant="ghost"
              onClick={handleDelete}
              disabled={deleting || saving}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Remove Configuration
            </Button>
          )}
        </div>
        <Button
          onClick={handleSave}
          disabled={saving || deleting}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              {config ? "Update Configuration" : "Save Configuration"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
