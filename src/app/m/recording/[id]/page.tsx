export const dynamic = "force-dynamic";

/**
 * /m/recording/[id] — recording playback for the native Flutter shell.
 *
 * Auth handled by middleware. AppearanceProvider is mounted here
 * because RecordingPlayer (rendered inside EmbeddedRecordingView)
 * calls useTerminalTheme()/useAppearance() — the /m/* layout
 * deliberately excludes AppShell, so the provider lives at the page
 * scope.
 */

import { redirect } from "next/navigation";

import { AppearanceProvider } from "@/contexts/AppearanceContext";
import { EmbeddedRecordingView } from "@/components/mobile/embed/EmbeddedRecordingView";
import { getAuthSession } from "@/lib/auth-utils";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MobileRecordingPage({ params }: PageProps) {
  const { id } = await params;
  const auth = await getAuthSession();
  if (!auth?.user?.id) redirect("/login");

  return (
    <AppearanceProvider>
      <EmbeddedRecordingView recordingId={id} />
    </AppearanceProvider>
  );
}
