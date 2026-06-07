"use client";

import { MobileSetupPanel, ServiceTokenQrPanel } from "@/components/system";

export function MobileSection() {
  return (
    <div className="space-y-6">
      <MobileSetupPanel />
      <div className="border-t border-border" />
      <ServiceTokenQrPanel />
    </div>
  );
}
