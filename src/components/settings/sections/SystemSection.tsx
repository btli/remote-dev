"use client";

import { UpdateManager } from "@/components/system";
import { TmuxSessionManager } from "@/components/tmux";

export function SystemSection() {
  return (
    <div className="space-y-4">
      <UpdateManager />
      <div className="border-t border-border pt-4">
        <TmuxSessionManager />
      </div>
    </div>
  );
}
