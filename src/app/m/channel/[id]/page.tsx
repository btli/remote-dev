export const dynamic = "force-dynamic";

/**
 * /m/channel/[id] — single-channel view for the native Flutter shell.
 *
 * Auth: resolved via getAuthSession() (NextAuth credentials OR CF
 * Access JWT). Unauthenticated requests are redirected to /login by
 * src/middleware.ts before they reach this page.
 *
 * Providers mounted here (scoped to this route, not the /m/* layout):
 *   - PreferencesProvider — required transitively by ChannelProvider
 *     (it reads activeProject.folderId via usePreferencesContext()).
 *   - ProjectTreeProvider — required transitively by ChannelProvider
 *     (it reads activeNode via useProjectTree()).
 *   - ChannelProvider — required by EmbeddedChannelView, which calls
 *     useChannelContextOptional() and renders a "Channels unavailable."
 *     empty state when the provider is missing.
 *   - PeerChatProvider — required by MobileChannelView, which calls
 *     usePeerChatContext() unconditionally and throws if the provider
 *     is absent. Without it, the channel route crashes in any browser.
 *
 * AppearanceProvider is NOT mounted: MobileChannelView never calls
 * useTerminalTheme()/useAppearance(), so the channel surface doesn't
 * pay for it.
 *
 * Note on params.id: ChannelProvider's current API takes only
 * { children } — there is no initialChannelId / selectedChannelId
 * prop, and activeChannelId is internal state initialized to null.
 * For v1 we accept the deep-link id but do not pre-select the
 * channel; the user lands on the channel list. A follow-up should
 * either extend ChannelProviderProps with initialChannelId or expose
 * a setter via ref so EmbeddedChannelView can call
 * setActiveChannelId(id) on mount.
 */

import { redirect } from "next/navigation";

import { ChannelProvider } from "@/contexts/ChannelContext";
import { PeerChatProvider } from "@/contexts/PeerChatContext";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { ProjectTreeProvider } from "@/contexts/ProjectTreeContext";
import { EmbeddedChannelView } from "@/components/mobile/embed/EmbeddedChannelView";
import { getAuthSession } from "@/lib/auth-utils";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MobileChannelPage({ params }: PageProps) {
  // Resolve params (Next.js requires awaiting dynamic-segment params)
  // and auth. The id is currently unused at the server layer — see
  // file-level docblock for the v1 limitation.
  await params;
  const auth = await getAuthSession();
  if (!auth?.user?.id) {
    redirect("/login");
  }

  return (
    <PreferencesProvider>
      <ProjectTreeProvider>
        <ChannelProvider>
          <PeerChatProvider>
            <EmbeddedChannelView />
          </PeerChatProvider>
        </ChannelProvider>
      </ProjectTreeProvider>
    </PreferencesProvider>
  );
}
