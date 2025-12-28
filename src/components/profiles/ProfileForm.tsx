"use client";

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type {
  AgentProfile,
  AgentProvider,
  CreateAgentProfileInput,
  UpdateAgentProfileInput,
} from "@/types/agent";
import { PROVIDER_DISPLAY_NAMES } from "@/types/agent";

interface ProfileFormProps {
  profile?: AgentProfile | null;
  onSubmit: (input: CreateAgentProfileInput | UpdateAgentProfileInput) => Promise<void>;
  onCancel: () => void;
  isCreating?: boolean;
}

const PROVIDER_OPTIONS: { value: AgentProvider; label: string }[] = [
  { value: "claude", label: PROVIDER_DISPLAY_NAMES.claude },
  { value: "codex", label: PROVIDER_DISPLAY_NAMES.codex },
  { value: "gemini", label: PROVIDER_DISPLAY_NAMES.gemini },
  { value: "opencode", label: PROVIDER_DISPLAY_NAMES.opencode },
  { value: "all", label: PROVIDER_DISPLAY_NAMES.all },
];

export function ProfileForm({
  profile,
  onSubmit,
  onCancel,
  isCreating = false,
}: ProfileFormProps) {
  const [name, setName] = useState(profile?.name || "");
  const [description, setDescription] = useState(profile?.description || "");
  const [provider, setProvider] = useState<AgentProvider>(profile?.provider || "claude");
  const [isDefault, setIsDefault] = useState(profile?.isDefault || false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when profile changes
  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setDescription(profile.description || "");
      setProvider(profile.provider);
      setIsDefault(profile.isDefault);
    } else {
      setName("");
      setDescription("");
      setProvider("claude");
      setIsDefault(false);
    }
    setError(null);
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (isCreating) {
        await onSubmit({
          name: name.trim(),
          description: description.trim() || undefined,
          provider,
          isDefault,
        } as CreateAgentProfileInput);
      } else {
        await onSubmit({
          name: name.trim(),
          description: description.trim() || undefined,
          provider,
          isDefault,
        } as UpdateAgentProfileInput);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="profile-name" className="text-muted-foreground">
          Name <span className="text-red-400">*</span>
        </Label>
        <Input
          id="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Profile"
          className="bg-card border-border text-foreground placeholder:text-muted-foreground/70"
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="profile-description" className="text-muted-foreground">
          Description
        </Label>
        <Textarea
          id="profile-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description for this profile"
          className="bg-card border-border text-foreground placeholder:text-muted-foreground/70 min-h-[60px]"
        />
      </div>

      {/* Provider */}
      <div className="space-y-2">
        <Label htmlFor="profile-provider" className="text-muted-foreground">
          Agent Provider
        </Label>
        <Select value={provider} onValueChange={(v) => setProvider(v as AgentProvider)}>
          <SelectTrigger className="bg-card border-border text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            {PROVIDER_OPTIONS.map((option) => (
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
        <p className="text-xs text-muted-foreground/70">
          Select the AI agent this profile is optimized for
        </p>
      </div>

      {/* Default toggle */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
        <div className="space-y-0.5">
          <Label className="text-muted-foreground">Set as Default</Label>
          <p className="text-xs text-muted-foreground/70">
            Use this profile for new sessions by default
          </p>
        </div>
        <Switch
          checked={isDefault}
          onCheckedChange={setIsDefault}
          disabled={profile?.isDefault}
        />
      </div>

      {/* Error message */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={saving}
          className="text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={saving}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : isCreating ? (
            "Create Profile"
          ) : (
            "Save Changes"
          )}
        </Button>
      </div>
    </form>
  );
}
