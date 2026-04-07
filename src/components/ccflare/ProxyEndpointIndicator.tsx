"use client";

/**
 * ProxyEndpointIndicator - Shows active API endpoint alias in the header.
 *
 * Matches the live proxy state (from PreToolUse hook) against ccflare API key
 * entries by baseUrl + keyPrefix. If a match is found, displays the key's name
 * (alias). If no match, shows the raw endpoint + an add button to create an entry.
 * Hidden on mobile via `hidden md:flex`.
 */

import { useState, useEffect } from "react";
import { Network, Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useCcflareContext } from "@/contexts/CcflareContext";
import { useSessionContext } from "@/contexts/SessionContext";
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
  const { isRunning, proxyUrl, keys, loading } = useCcflareContext();
  const { activeSessionId } = useSessionContext();
  const [proxyState, setProxyState] = useState<{ baseUrl: string; keyPrefix: string; apiKey: string } | null>(null);

  // Fetch proxy state from terminal server using the active session ID
  useEffect(() => {
    if (!activeSessionId) return;
    fetch(`/api/ccflare/keys/active?sessionId=${encodeURIComponent(activeSessionId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.baseUrl || data?.apiKey) {
          setProxyState({ baseUrl: data.baseUrl ?? "", keyPrefix: data.keyPrefix ?? "", apiKey: data.apiKey ?? "" });
        }
      })
      .catch(() => {});
  }, [activeSessionId]);

  // Derive display values from fetched proxy state or ccflare config fallback
  let baseUrl: string | null = null;
  let keyPrefix: string | null = null;

  if (proxyState?.baseUrl) {
    baseUrl = proxyState.baseUrl;
    keyPrefix = proxyState.keyPrefix || null;
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

  const effectiveBaseUrl = isAnthropic ? ANTHROPIC_DEFAULT_BASE_URL : baseUrl;
  const fullApiKey = proxyState?.apiKey || null;
  const truncatedKey = fullApiKey
    ? `${fullApiKey.slice(0, 12)}...${fullApiKey.slice(-4)}`
    : keyPrefix ? `${keyPrefix}...` : null;

  const handleAdd = () => {
    window.dispatchEvent(
      new CustomEvent("open-settings", {
        detail: {
          section: "proxy",
          proxyPrefill: {
            baseUrl: isAnthropic ? "" : (baseUrl ?? ""),
            apiKey: fullApiKey ?? "",
          },
        },
      })
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
        <TooltipContent className="text-xs">
          <div>ANTHROPIC_BASE_URL: {hasAlias ? (matchedKey.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL) : effectiveBaseUrl}</div>
          {truncatedKey && <div>ANTHROPIC_API_KEY: {truncatedKey}</div>}
        </TooltipContent>
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
