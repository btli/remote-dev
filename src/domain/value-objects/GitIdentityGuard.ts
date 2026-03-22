/**
 * GitIdentityGuard - Pure domain rule for evaluating commit identity risks.
 *
 * Evaluates whether a proposed commit author identity would leak the user's
 * real identity in a sensitive folder context. Returns a risk level and
 * human-readable reason.
 *
 * Risk levels:
 * - "none": No identity concern — proceed normally
 * - "warn": Identity mismatch detected — advise the user
 * - "block": Sensitive folder without pseudonymous identity configured — block push
 */

import { FolderGitIdentity } from "./FolderGitIdentity";

export type IdentityRisk = "none" | "warn" | "block";

export interface IdentityGuardResult {
  risk: IdentityRisk;
  reason: string | null;
}

export class GitIdentityGuard {
  /**
   * Evaluate whether a proposed git operation is safe from an identity perspective.
   *
   * @param identity - The folder's git identity configuration
   * @param proposedName - The git user.name that would be used for the commit
   * @param proposedEmail - The git user.email that would be used for the commit
   * @param operation - The git operation being performed ("commit" or "push")
   */
  static evaluate(
    identity: FolderGitIdentity,
    proposedName: string,
    proposedEmail: string,
    operation: "commit" | "push" = "commit"
  ): IdentityGuardResult {
    // Non-sensitive folders have no restrictions
    if (!identity.isSensitive) {
      return { risk: "none", reason: null };
    }

    // Sensitive folder without pseudonymous identity configured (or incomplete)
    if (!identity.isValidForSensitive()) {
      const detail = !identity.hasIdentity()
        ? "no pseudonymous git identity is configured"
        : "the configured identity is incomplete (both name and email are required)";

      if (operation === "push") {
        return {
          risk: "block",
          reason:
            `This folder is marked as sensitive but ${detail}. ` +
            "Configure a git identity in folder preferences before pushing.",
        };
      }
      return {
        risk: "warn",
        reason:
          `This folder is marked as sensitive but ${detail}. ` +
          "Commits may use your real identity. Configure a git identity in folder preferences.",
      };
    }

    // Build mismatch descriptions for the proposed identity vs configured pseudonym
    const mismatches: string[] = [];
    if (identity.gitIdentityName && proposedName !== identity.gitIdentityName) {
      mismatches.push(
        `name "${proposedName}" does not match configured "${identity.gitIdentityName}"`
      );
    }
    if (identity.gitIdentityEmail && proposedEmail !== identity.gitIdentityEmail) {
      mismatches.push(
        `email "${proposedEmail}" does not match configured "${identity.gitIdentityEmail}"`
      );
    }

    if (mismatches.length > 0) {
      const detail = `Identity mismatch in sensitive folder: ${mismatches.join("; ")}.`;

      if (operation === "push") {
        return {
          risk: "block",
          reason: `${detail} This may leak your real identity. Update your git config or folder preferences.`,
        };
      }

      return {
        risk: "warn",
        reason: `${detail} This may leak your real identity.`,
      };
    }

    // Identity matches — all clear
    return { risk: "none", reason: null };
  }
}
