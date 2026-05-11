"use client";

/**
 * AgentProviderConfigCard — controlled editor for a single agent provider's
 * runtime settings (extra default flags + allow-dangerous toggle).
 *
 * Reused by:
 *   - Settings → Agents (user-level defaults)
 *   - Project preferences (project-level overrides that REPLACE the user
 *     entry for the same provider key)
 *
 * Stores extra flags as a `string[]` to keep the eventual `buildAgentCommand`
 * call free of shell interpolation. The textarea splits on whitespace on
 * blur — users type space- or newline-separated flag tokens.
 */

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AgentProviderConfig } from "@/types/session";
import type { AgentProviderSettings } from "@/types/preferences";

interface Props {
  provider: AgentProviderConfig;
  settings: AgentProviderSettings;
  onChange: (next: AgentProviderSettings) => void;
}

function joinFlags(flags: string[]): string {
  return flags.join(" ");
}

function parseFlags(raw: string): string[] {
  return raw
    .split(/\s+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function AgentProviderConfigCard({ provider, settings, onChange }: Props) {
  const [flagsText, setFlagsText] = useState(() => joinFlags(settings.extraFlags ?? []));

  // Re-sync the text buffer when the underlying settings switch out (e.g.
  // user navigates between projects). We only want to overwrite the local
  // buffer if the canonical value diverges from what we last parsed.
  useEffect(() => {
    const canonical = joinFlags(settings.extraFlags ?? []);
    const buffered = joinFlags(parseFlags(flagsText));
    if (canonical !== buffered) {
      setFlagsText(canonical);
    }
    // We intentionally only respond to outside settings changes, not user
    // typing — local buffer is the source of truth between blur events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.extraFlags?.join(" ")]);

  const dangerousFlags = provider.dangerousFlags ?? [];
  const hasDangerous = dangerousFlags.length > 0;

  // Preview of the final command — surfaced read-only so users see the
  // exact line that will run. Filters dangerous flags when allowDangerous
  // is off, mirroring `buildAgentCommand`. Defensive `?? []` guard handles
  // older saved settings that pre-date the `extraFlags` field.
  const extraFlags = settings.extraFlags ?? [];
  const previewFlags = settings.allowDangerous
    ? extraFlags
    : extraFlags.filter((f) => !dangerousFlags.includes(f));
  const previewParts = [
    provider.command,
    ...provider.defaultFlags,
    ...previewFlags,
  ];

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">{provider.name}</span>
          <span className="text-[11px] text-muted-foreground font-mono">{provider.command}</span>
        </div>
        <div className="flex items-center gap-2">
          <Label
            htmlFor={`allow-dangerous-${provider.id}`}
            className={hasDangerous ? "text-xs" : "text-xs text-muted-foreground"}
          >
            Allow dangerous flags
          </Label>
          <Switch
            id={`allow-dangerous-${provider.id}`}
            checked={!!settings.allowDangerous}
            disabled={!hasDangerous}
            onCheckedChange={(checked) =>
              onChange({ ...settings, allowDangerous: !!checked })
            }
          />
        </div>
      </div>

      {hasDangerous && (
        <p className="text-[11px] text-muted-foreground">
          Enables: {dangerousFlags.join(", ")}
        </p>
      )}
      {!hasDangerous && (
        <p className="text-[11px] text-muted-foreground">
          This provider has no dangerous flags.
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`extra-flags-${provider.id}`} className="text-xs">
          Extra default flags
        </Label>
        <Textarea
          id={`extra-flags-${provider.id}`}
          value={flagsText}
          onChange={(e) => setFlagsText(e.target.value)}
          onBlur={() => {
            const next = parseFlags(flagsText);
            // Re-canonicalize the buffer to drop incidental whitespace so the
            // preview line matches the stored value.
            setFlagsText(joinFlags(next));
            onChange({ ...settings, extraFlags: next });
          }}
          rows={2}
          placeholder="--verbose --model claude-3-5-sonnet"
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Whitespace-separated tokens appended after the provider&rsquo;s defaults.
        </p>
      </div>

      <div className="space-y-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Preview
        </span>
        <code className="block text-[11px] font-mono text-foreground/80 bg-muted/40 rounded px-2 py-1 overflow-x-auto whitespace-nowrap">
          {previewParts.join(" ")}
        </code>
      </div>
    </div>
  );
}
