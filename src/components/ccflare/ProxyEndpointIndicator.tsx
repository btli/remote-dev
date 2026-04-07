"use client";

/**
 * ProxyEndpointIndicator - Shows active API endpoint alias in the header.
 *
 * Matches the live proxy state (from PreToolUse hook) against ccflare API key
 * entries by baseUrl + keyPrefix. If a match is found, displays the key's name
 * (alias). If no match, shows the raw endpoint + an add button to create an entry.
 * Hidden on mobile via `hidden md:flex`.
 */

import { Network, Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useCcflareContext } from "@/contexts/CcflareContext";
import { ANTHROPIC_DEFAULT_BASE_URL } from "@/types/ccflare";
import type { CcflareApiKey } from "@/types/ccflare";
import { cn } from "@/lib/utils";

function formatHostname(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
      return `${parsed.hostname}:${parsed.port}`;
    }
    return parsed.hostname;
  } catch {
    return url;
  }
}

/**
 * Check if a reported ANTHROPIC_BASE_URL is targeting Anthropic (via proxy or direct).
 * The proxy rewrites the URL locally, and the hook defaults to api.anthropic.com when unset.
 */
function isAnthropicEndpoint(baseUrl: string): boolean {
  if (baseUrl.includes("127.0.0.1") || baseUrl.includes("localhost")) return true;
  return baseUrl === ANTHROPIC_DEFAULT_BASE_URL || baseUrl.startsWith("https://api.anthropic.com");
}

/**
 * Match a live proxy state report against stored ccflare API key entries.
 * Anthropic-targeting URLs (proxy or direct) match keys with null baseUrl.
 * Custom endpoints match by baseUrl, refined by keyPrefix.
 */
function findMatchingKey(
  keys: CcflareApiKey[],
  baseUrl: string | null,
  keyPrefix: string | null,
): CcflareApiKey | null {
  if (!baseUrl && !keyPrefix) return null;

  const isAnthropic = baseUrl ? isAnthropicEndpoint(baseUrl) : false;

  for (const key of keys) {
    if (isAnthropic) {
      // Anthropic endpoint (proxy or direct): match keys without a custom baseUrl
      if (key.baseUrl) continue;
      if (keyPrefix && key.keyPrefix && key.keyPrefix.startsWith(keyPrefix.slice(0, 8))) return key;
      if (!keyPrefix && !key.baseUrl) return key;
    } else {
      // Custom endpoint: match by ANTHROPIC_BASE_URL value
      if (baseUrl && key.baseUrl === baseUrl) {
        if (keyPrefix && key.keyPrefix) {
          if (key.keyPrefix.startsWith(keyPrefix.slice(0, 8))) return key;
        } else {
          return key;
        }
      }
    }
  }

  return null;
}

export function ProxyEndpointIndicator() {
  const { activeProxyState, isRunning, proxyUrl, keys, loading } = useCcflareContext();

  // Derive display values from live proxy state or ccflare config fallback
  let baseUrl: string | null = null;
  let keyPrefix: string | null = null;

  if (activeProxyState?.baseUrl) {
    baseUrl = activeProxyState.baseUrl;
    keyPrefix = activeProxyState.keyPrefix;
  } else if (isRunning && proxyUrl) {
    baseUrl = proxyUrl;
  }

  if (!baseUrl || loading) return null;

  const isAnthropic = isAnthropicEndpoint(baseUrl);
  const matchedKey = findMatchingKey(keys, baseUrl, keyPrefix);
  const hasAlias = !!matchedKey;

  // Resolve display hostname: show api.anthropic.com for proxy/default instead of 127.0.0.1
  const resolvedHostname = isAnthropic
    ? "api.anthropic.com"
    : formatHostname(baseUrl);

  const displayLabel = hasAlias
    ? matchedKey.name
    : resolvedHostname;

  const tooltipText = hasAlias
    ? `ANTHROPIC_BASE_URL: ${matchedKey.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL}`
    : `ANTHROPIC_BASE_URL: ${isAnthropic ? ANTHROPIC_DEFAULT_BASE_URL : baseUrl}${keyPrefix ? ` \u2022 ${keyPrefix}...` : ""}`;

  const handleAdd = () => {
    // Pre-fill the add-key form with the detected endpoint
    const prefillUrl = isAnthropic ? "" : (baseUrl ?? "");
    window.dispatchEvent(
      new CustomEvent("rdv:prefill-proxy-key", { detail: { baseUrl: prefillUrl } })
    );
    window.dispatchEvent(
      new CustomEvent("open-settings", { detail: { section: "proxy" } })
    );
  };

  return (
    <div className="hidden md:flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 border border-border text-xs text-muted-foreground cursor-default select-none">
            <Network
              className={cn(
                "w-3 h-3 shrink-0",
                isAnthropic ? "text-green-400" : "text-blue-400"
              )}
            />
            <span className="truncate max-w-[180px]">{displayLabel}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>

      {!hasAlias && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={handleAdd}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Save endpoint to proxy config</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
