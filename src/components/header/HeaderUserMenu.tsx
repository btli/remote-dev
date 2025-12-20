"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { UserSettingsModal } from "@/components/preferences/UserSettingsModal";

interface HeaderUserMenuProps {
  email: string;
}

export function HeaderUserMenu({ email }: HeaderUserMenuProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsSettingsOpen(true)}
        className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
      >
        <Settings className="w-4 h-4" />
        <span>{email}</span>
      </button>

      <UserSettingsModal
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </>
  );
}
