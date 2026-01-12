"use client";

/**
 * Client-side wrapper for SessionManager to prevent Radix UI hydration mismatch.
 *
 * Radix UI components generate different IDs on server vs client, causing
 * hydration errors. Using dynamic import with ssr: false ensures these
 * components only render on the client.
 */

import dynamic from "next/dynamic";

// Dynamic import with ssr: false to prevent Radix UI hydration mismatch
const SessionManager = dynamic(
  () => import("./SessionManager").then((mod) => mod.SessionManager),
  { ssr: false }
);

interface SessionManagerClientProps {
  isGitHubConnected: boolean;
}

export function SessionManagerClient({ isGitHubConnected }: SessionManagerClientProps) {
  return <SessionManager isGitHubConnected={isGitHubConnected} />;
}
