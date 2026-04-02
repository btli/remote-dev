"use client";

import { LogViewer } from "@/components/system";

export function LogsSection() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <LogViewer />
    </div>
  );
}
