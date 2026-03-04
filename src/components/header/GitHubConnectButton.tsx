"use client";

import { Button } from "@/components/ui/button";
import { Github, Plus } from "lucide-react";

interface GitHubConnectButtonProps {
  isConnected?: boolean;
}

export function GitHubConnectButton({ isConnected = false }: GitHubConnectButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground"
      onClick={() => {
        window.location.href = "/api/auth/github/link";
      }}
    >
      {isConnected ? (
        <>
          <Plus className="w-4 h-4 mr-2" />
          Add GitHub Account
        </>
      ) : (
        <>
          <Github className="w-4 h-4 mr-2" />
          Connect GitHub
        </>
      )}
    </Button>
  );
}
