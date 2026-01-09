/**
 * Safety Detector - Detects dangerous commands and restricted access attempts.
 *
 * Detection methods:
 * 1. Dangerous command patterns (rm -rf /, fork bombs, etc.)
 * 2. Restricted resource access attempts
 * 3. Attempts to disable oversight
 */

import type { OverseerIssue } from "@/domain/entities/OverseerCheck";
import type { DetectorContext, DetectorResult, PatternDetector } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Dangerous Patterns
// ─────────────────────────────────────────────────────────────────────────────

interface DangerousPattern {
  pattern: RegExp;
  severity: "high" | "critical";
  description: string;
}

const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // Destructive file operations
  {
    pattern: /rm\s+(-[rf]+\s+)*[\/~]\s*$/i,
    severity: "critical",
    description: "Recursive delete on root or home directory",
  },
  {
    pattern: /rm\s+-rf?\s+\/\*/i,
    severity: "critical",
    description: "Recursive delete on root filesystem",
  },
  {
    pattern: />\s*\/dev\/sd[a-z]/i,
    severity: "critical",
    description: "Direct write to block device",
  },
  {
    pattern: /dd\s+.*of=\/dev\/sd[a-z]/i,
    severity: "critical",
    description: "dd write to block device",
  },
  {
    pattern: /mkfs\./i,
    severity: "critical",
    description: "Filesystem creation command",
  },

  // Fork bombs and resource exhaustion
  {
    pattern: /:\(\)\{\s*:\|:&\s*\};:/,
    severity: "critical",
    description: "Fork bomb detected",
  },
  {
    pattern: /while\s*true.*do.*done/i,
    severity: "high",
    description: "Potential infinite loop",
  },

  // Privilege escalation attempts
  {
    pattern: /sudo\s+su\s*$/i,
    severity: "high",
    description: "Privilege escalation to root",
  },
  {
    pattern: /chmod\s+777\s+\//i,
    severity: "critical",
    description: "Chmod 777 on root directory",
  },
  {
    pattern: /chown\s+-R\s+.*\s+\//i,
    severity: "critical",
    description: "Recursive chown on root directory",
  },

  // Network attacks
  {
    pattern: /nmap\s+-sS/i,
    severity: "high",
    description: "SYN scan detected (potential network reconnaissance)",
  },
  {
    pattern: /curl\s+.*\|\s*sh/i,
    severity: "high",
    description: "Pipe remote script to shell",
  },
  {
    pattern: /wget\s+.*\|\s*sh/i,
    severity: "high",
    description: "Pipe remote script to shell",
  },

  // Credential/secret access
  {
    pattern: /cat\s+.*\.ssh\/id_rsa/i,
    severity: "high",
    description: "SSH private key access attempt",
  },
  {
    pattern: /cat\s+.*\.env/i,
    severity: "high",
    description: "Environment file access (may contain secrets)",
  },
  {
    pattern: /history\s*$/i,
    severity: "high",
    description: "Shell history access (may contain credentials)",
  },

  // System modification
  {
    pattern: /systemctl\s+(disable|stop)\s+.*security/i,
    severity: "critical",
    description: "Disabling security services",
  },
  {
    pattern: /iptables\s+-F/i,
    severity: "high",
    description: "Flushing firewall rules",
  },
];

// Patterns that indicate attempting to disable oversight
const OVERSIGHT_BYPASS_PATTERNS: RegExp[] = [
  /kill.*overseer|oversight|monitor/i,
  /pkill.*overseer|oversight|monitor/i,
  /killall.*overseer|oversight|monitor/i,
  /stop.*oversight|monitoring/i,
  /disable.*oversight|monitoring/i,
];

export const safetyDetector: PatternDetector = {
  name: "safety-detector",

  detect(context: DetectorContext): DetectorResult {
    const issues: OverseerIssue[] = [];
    const { observations } = context;

    // Combine recent command history with current
    const allCommands = observations.commandHistory;

    // Check each command for dangerous patterns
    for (const cmd of allCommands) {
      const dangerIssue = detectDangerousCommand(cmd);
      if (dangerIssue) issues.push(dangerIssue);

      const bypassIssue = detectOversightBypass(cmd);
      if (bypassIssue) issues.push(bypassIssue);
    }

    // Check for restricted file access
    const fileIssue = detectRestrictedFileAccess(observations.filesModified);
    if (fileIssue) issues.push(fileIssue);

    return {
      detected: issues.length > 0,
      issues,
    };
  },
};

/**
 * Detect dangerous command patterns.
 */
function detectDangerousCommand(command: string): OverseerIssue | null {
  for (const { pattern, severity, description } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        type: "safety_violation",
        severity,
        description: `Dangerous command detected: ${description}`,
        evidence: [
          `Command: ${command.substring(0, 100)}${command.length > 100 ? "..." : ""}`,
          `Pattern matched: ${description}`,
        ],
        confidence: 0.95,
      };
    }
  }
  return null;
}

/**
 * Detect attempts to bypass oversight.
 */
function detectOversightBypass(command: string): OverseerIssue | null {
  for (const pattern of OVERSIGHT_BYPASS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        type: "safety_violation",
        severity: "critical",
        description: "Attempting to disable oversight system",
        evidence: [
          `Command: ${command.substring(0, 100)}`,
          "Agent may be trying to bypass safety monitoring",
        ],
        confidence: 0.9,
      };
    }
  }
  return null;
}

/**
 * Detect access to restricted files.
 */
function detectRestrictedFileAccess(
  filesModified: string[]
): OverseerIssue | null {
  const restrictedPatterns = [
    /\/etc\/passwd/i,
    /\/etc\/shadow/i,
    /\/etc\/sudoers/i,
    /\.ssh\/authorized_keys/i,
    /\.ssh\/config/i,
    /\.bashrc|\.zshrc|\.profile/i,
  ];

  const violations: string[] = [];
  for (const file of filesModified) {
    for (const pattern of restrictedPatterns) {
      if (pattern.test(file)) {
        violations.push(file);
        break;
      }
    }
  }

  if (violations.length > 0) {
    return {
      type: "safety_violation",
      severity: "high",
      description: `Access to restricted system files detected`,
      evidence: [
        `Files accessed: ${violations.join(", ")}`,
        "These files are typically protected and should not be modified by coding agents",
      ],
      confidence: 0.9,
    };
  }

  return null;
}
