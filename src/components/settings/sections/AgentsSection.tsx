"use client";

/**
 * Settings → Agents section.
 *
 * Three stacked groups:
 *   1) Default agent selector — used by the one-click "New Agent" affordance.
 *   2) AgentCLIStatusPanel — install status for all four providers.
 *   3) Per-provider config cards — extra flags + allow-dangerous toggle.
 *      Stored at user-level; projects can override the whole map.
 */

import { AgentCLIStatusPanel, AgentProviderConfigCard } from "@/components/agents";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import {
  AGENT_PROVIDERS,
  type AgentProviderType,
} from "@/types/session";
import {
  DEFAULT_AGENT_PROVIDER_SETTINGS,
  type AgentProviderSettings,
  type AgentProviderSettingsMap,
} from "@/types/preferences";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ConfigurableProvider = Exclude<AgentProviderType, "none">;

export function AgentsSection() {
  const { userSettings, updateUserSettings } = usePreferencesContext();

  const currentDefault: AgentProviderType =
    userSettings?.defaultAgentProvider ?? "claude";
  const currentMap: AgentProviderSettingsMap =
    userSettings?.agentProviderSettings ?? {};

  const handleDefaultChange = (value: string) => {
    void updateUserSettings({
      defaultAgentProvider: value as AgentProviderType,
    });
  };

  const handleProviderSettingsChange = (
    provider: ConfigurableProvider,
    next: AgentProviderSettings
  ) => {
    const map: AgentProviderSettingsMap = { ...currentMap, [provider]: next };
    void updateUserSettings({ agentProviderSettings: map });
  };

  const configurableProviders = AGENT_PROVIDERS.filter(
    (p): p is typeof p & { id: ConfigurableProvider } => p.id !== "none"
  );

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <Label htmlFor="default-agent-provider" className="text-sm">
          Default agent
        </Label>
        <Select value={currentDefault} onValueChange={handleDefaultChange}>
          <SelectTrigger id="default-agent-provider" className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {configurableProviders.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Used when you click &ldquo;New Agent&rdquo; without picking a specific provider.
          Projects can override this in their preferences.
        </p>
      </section>

      <AgentCLIStatusPanel />

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Per-agent defaults</h3>
          <p className="text-xs text-muted-foreground">
            Extra CLI flags applied to every agent session you create with the
            given provider. Project preferences can replace this map.
          </p>
        </div>
        {configurableProviders.map((provider) => (
          <AgentProviderConfigCard
            key={provider.id}
            provider={provider}
            settings={currentMap[provider.id] ?? DEFAULT_AGENT_PROVIDER_SETTINGS}
            onChange={(next) => handleProviderSettingsChange(provider.id, next)}
          />
        ))}
      </section>
    </div>
  );
}
