"use client";

/**
 * AboutScreen — Profile › About.
 *
 * Phase 6: real, minimal content. Lists the app version, a link to the
 * GitHub repo, and the licence line. No marketing decoration.
 *
 * The version is read from a build-time constant (defaults to "dev"
 * when not present) so we don't import package.json into client
 * bundles. Update the constant when the release process is wired.
 */

import { SubScreen } from "../SubScreen";

export interface AboutScreenProps {
  onBack: () => void;
}

const APP_VERSION =
  // Surfaced by Next.js when configured in next.config; falls back to "dev"
  // so tests don't have to mock the build env. Updated by the release script.
  process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

const REPO_URL = "https://github.com/btli/remote-dev";

export function AboutScreen({ onBack }: AboutScreenProps) {
  return (
    <SubScreen title="About" onBack={onBack}>
      <div className="flex flex-col gap-4 px-4 py-6 text-[14px]">
        <dl className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Application</dt>
            <dd className="text-right font-medium text-foreground">Remote Dev</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="text-right font-mono text-[13px] text-foreground">
              {APP_VERSION}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Repository</dt>
            <dd className="text-right">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[13px] text-foreground underline-offset-2 hover:underline"
              >
                btli/remote-dev
              </a>
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
          A web-based terminal interface with persistent tmux sessions,
          multi-agent CLIs, and a quiet, gesture-literate mobile surface.
        </p>
      </div>
    </SubScreen>
  );
}
