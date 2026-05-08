/**
 * Layout for /m/* mobile-embed routes.
 *
 * These routes are loaded by the new Flutter app's WebView host and
 * render only their target surface (terminal, channel, recording) —
 * no MobileShell, no bottom tab bar, no AppShell.
 *
 * Auth gating is handled by `src/middleware.ts` (which protects every
 * route except /login and /api). When CF Access challenges, the
 * challenge happens *inside* the WebView and lands the user back here
 * with a CF_Authorization cookie set on the WebView's cookie store —
 * see spec §3.
 *
 * We deliberately do NOT mount the heavy desktop providers
 * (Template, Recording, Trash, Schedule, Secrets, GitHubAccount, …) so
 * the embed bundle stays lean. Surface-specific providers live inside
 * each surface's page.
 */

import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Remote Dev",
  description: "Remote Dev mobile embed",
};

export const viewport: Viewport = {
  themeColor: "#1a1b26",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function MobileEmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#1a1b26]">
      {children}
    </div>
  );
}
