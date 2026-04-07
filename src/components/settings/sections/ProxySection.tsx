"use client";

import { CcflareSettingsPanel } from "@/components/ccflare/CcflareSettingsPanel";

interface ProxySectionProps {
  prefill?: { baseUrl?: string; apiKey?: string };
}

export function ProxySection({ prefill }: ProxySectionProps) {
  return (
    <div className="space-y-4">
      <CcflareSettingsPanel prefill={prefill} />
    </div>
  );
}
