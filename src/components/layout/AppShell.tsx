"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "sonner";
import { AppearanceProvider } from "@/contexts/AppearanceContext";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { runtimeBasePath } from "@/lib/api-fetch";

/**
 * AppShell wraps authenticated pages with the heavy global providers
 * (NextAuth session, appearance/theme, toaster, service worker registration).
 *
 * It is intentionally NOT loaded on the `/login` route, where these
 * providers add ~70KB of unused JS for a near-empty form. The root layout
 * lazy-imports this component so the login bundle never includes it.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  // `next-auth/react` defaults its API base to `/api/auth` at the bare origin,
  // ignoring Next's basePath. Under a slug instance the client session/CSRF/
  // signout calls would hit the root and 404/redirect-loop. Point it at the
  // runtime-prefixed path. Read the SSR-injected runtime slug (same source as
  // apiFetch) so one build works across instances.
  const clientBasePath = runtimeBasePath();
  return (
    <SessionProvider
      basePath={`${clientBasePath}/api/auth`}
      refetchInterval={5 * 60}
      refetchOnWindowFocus={true}
    >
      <AppearanceProvider>{children}</AppearanceProvider>
      <Toaster
        position="bottom-center"
        theme="dark"
        toastOptions={{
          classNames: {
            toast:
              "bg-popover/95 backdrop-blur-xl border border-border shadow-2xl text-popover-foreground",
            title: "font-medium text-sm",
            description: "text-xs text-muted-foreground",
            actionButton:
              "bg-primary text-primary-foreground text-xs px-2 py-1 rounded-md",
            closeButton: "text-muted-foreground hover:text-foreground",
          },
        }}
      />
      <ServiceWorkerRegistration />
    </SessionProvider>
  );
}
