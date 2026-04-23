/**
 * F6 — fetch the body for a single PR (GitHub treats PRs as issues for body
 * purposes) from the targeted single-issue endpoint added specifically to
 * bypass the `per_page=100` cap on the list endpoint. On busy repos the old
 * list-based approach silently dropped PR bodies past position 100.
 *
 * Extracted from `PRDetailView` in `prs-plugin-client.tsx` so the fetch URL
 * contract and 404/error fallback are unit-testable without rendering the
 * whole detail view.
 */
import { useEffect, useState } from "react";

export interface PRBodyState {
  /** The PR number the currently-stored body is keyed to, or null before first load. */
  prNumber: number | null;
  /** The resolved body text. `null` means "no description" or fetch failed. */
  body: string | null;
  loading: boolean;
}

export interface UsePRBodyResult {
  /**
   * The body for the currently-requested `prNumber`, or `null` when not yet
   * loaded (or when the API returned no description / 404).
   */
  body: string | null;
  /**
   * `true` while the request for the currently-requested `prNumber` is in
   * flight. Also `true` if `prNumber` just changed and the previous result
   * is stale.
   */
  loading: boolean;
}

export function usePRBody(
  repositoryId: string,
  prNumber: number
): UsePRBodyResult {
  const [state, setState] = useState<PRBodyState>({
    prNumber: null,
    body: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/github/repositories/${repositoryId}/issues/${prNumber}`)
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))
      )
      .then(
        (data: { issue?: { number: number; body?: string | null } }) => {
          if (cancelled) return;
          setState({
            prNumber,
            body: data.issue?.body ?? null,
            loading: false,
          });
        }
      )
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to fetch PR body:", err);
        setState({ prNumber, body: null, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [repositoryId, prNumber]);

  const body = state.prNumber === prNumber ? state.body : null;
  const loading = state.prNumber !== prNumber || state.loading;
  return { body, loading };
}
