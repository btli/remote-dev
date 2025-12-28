"use client";

import { Button } from "@/components/ui/button";
import { Github } from "lucide-react";

export function GitHubConnectButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground"
      onClick={() => {
        window.location.href = "/api/auth/github/link";
      }}
    >
      <Github className="w-4 h-4 mr-2" />
      Connect GitHub
    </Button>
  );
}
