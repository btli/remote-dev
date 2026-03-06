import {
  CircleDot,
  CircleCheck,
  GitPullRequest,
  GitMerge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GitHubIssueDTO } from "@/contexts/GitHubIssuesContext";

/**
 * Returns the appropriate icon for a GitHub issue or PR based on type and state.
 *
 * Issues: CircleDot (open, green) / CircleCheck (closed, purple)
 * PRs: GitPullRequest (open, green) / GitMerge (closed, purple)
 */
export function getIssueIcon(
  issue: Pick<GitHubIssueDTO, "isPullRequest" | "state">,
  className?: string
) {
  if (issue.isPullRequest) {
    if (issue.state === "closed") {
      return <GitMerge className={cn("text-purple-500", className)} />;
    }
    return <GitPullRequest className={cn("text-chart-2", className)} />;
  }
  if (issue.state === "closed") {
    return <CircleCheck className={cn("text-purple-500", className)} />;
  }
  return <CircleDot className={cn("text-chart-2", className)} />;
}
