import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In — Remote Dev",
  description: "Sign in to Remote Dev terminal interface",
};

/**
 * Minimal layout for the public auth route group (e.g. /login).
 *
 * Intentionally renders only `{children}` so the route inherits the
 * provider-free root layout branch. See `src/app/layout.tsx` — when the
 * pathname is `/login`, the heavy `<AppShell>` (NextAuth session provider,
 * appearance provider, Toaster, service worker registration) is skipped.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
