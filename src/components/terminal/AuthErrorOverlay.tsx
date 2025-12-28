"use client";

import { Button } from "@/components/ui/button";
import { RefreshCw, ShieldAlert } from "lucide-react";

interface AuthErrorOverlayProps {
  message?: string;
}

export function AuthErrorOverlay({ message }: AuthErrorOverlayProps) {
  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/90 backdrop-blur-sm z-20">
      <div className="max-w-md w-full mx-4 p-6 rounded-xl bg-card/90 border border-border shadow-2xl">
        <div className="text-center mb-6">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/20 flex items-center justify-center mb-4">
            <ShieldAlert className="w-6 h-6 text-destructive" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            Authentication Failed
          </h3>
          <p className="text-sm text-muted-foreground">
            {message || "Your session may have expired. Please refresh the page to re-authenticate."}
          </p>
        </div>

        <div className="flex justify-center">
          <Button
            onClick={handleRefresh}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh Page
          </Button>
        </div>
      </div>
    </div>
  );
}
