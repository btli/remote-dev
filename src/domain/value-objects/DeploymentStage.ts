/**
 * DeploymentStage - Value object representing the lifecycle stage of an auto-update deployment.
 *
 * Stages:
 *   detected → scheduled → draining → applying → applied
 *                                    └─► failed
 *                                    └─► rolledBack
 *
 * Each stage variant carries only the data relevant to it.
 */

export type DeploymentStageTag =
  | "detected"
  | "scheduled"
  | "draining"
  | "applying"
  | "applied"
  | "failed"
  | "rolled_back";

export type DeploymentStageVariant =
  | { tag: "detected" }
  | { tag: "scheduled"; scheduledFor: Date }
  | { tag: "draining" }
  | { tag: "applying" }
  | { tag: "applied" }
  | { tag: "failed"; reason: string }
  | { tag: "rolled_back" };

/** Serialized form for persistence (Dates as epoch ms). */
export interface DeploymentStagePlain {
  tag: DeploymentStageTag;
  scheduledFor?: number;
  reason?: string;
}

export class DeploymentStage {
  private constructor(private readonly variant: DeploymentStageVariant) {}

  static detected(): DeploymentStage {
    return new DeploymentStage({ tag: "detected" });
  }

  static scheduled(scheduledFor: Date): DeploymentStage {
    return new DeploymentStage({ tag: "scheduled", scheduledFor });
  }

  static draining(): DeploymentStage {
    return new DeploymentStage({ tag: "draining" });
  }

  static applying(): DeploymentStage {
    return new DeploymentStage({ tag: "applying" });
  }

  static applied(): DeploymentStage {
    return new DeploymentStage({ tag: "applied" });
  }

  static failed(reason: string): DeploymentStage {
    return new DeploymentStage({ tag: "failed", reason });
  }

  static rolledBack(): DeploymentStage {
    return new DeploymentStage({ tag: "rolled_back" });
  }

  get tag(): DeploymentStageTag {
    return this.variant.tag;
  }

  get scheduledFor(): Date | null {
    return this.variant.tag === "scheduled" ? this.variant.scheduledFor : null;
  }

  get failureReason(): string | null {
    return this.variant.tag === "failed" ? this.variant.reason : null;
  }

  isTerminal(): boolean {
    return this.variant.tag === "applied" || this.variant.tag === "failed" || this.variant.tag === "rolled_back";
  }

  isPending(): boolean {
    return this.variant.tag === "detected" || this.variant.tag === "scheduled";
  }

  isActive(): boolean {
    return this.variant.tag === "draining" || this.variant.tag === "applying";
  }

  equals(other: DeploymentStage): boolean {
    if (this.variant.tag !== other.variant.tag) return false;
    if (this.variant.tag === "scheduled" && other.variant.tag === "scheduled") {
      return this.variant.scheduledFor.getTime() === other.variant.scheduledFor.getTime();
    }
    if (this.variant.tag === "failed" && other.variant.tag === "failed") {
      return this.variant.reason === other.variant.reason;
    }
    return true;
  }

  /**
   * Serialize to a plain object for persistence.
   */
  toPlainObject(): DeploymentStagePlain {
    const v = this.variant;
    switch (v.tag) {
      case "scheduled":
        return { tag: v.tag, scheduledFor: v.scheduledFor.getTime() };
      case "failed":
        return { tag: v.tag, reason: v.reason };
      default:
        return { tag: v.tag };
    }
  }

  /**
   * Reconstitute from persisted data.
   */
  static fromPlainObject(obj: DeploymentStagePlain): DeploymentStage {
    switch (obj.tag) {
      case "detected": return DeploymentStage.detected();
      case "scheduled": return DeploymentStage.scheduled(new Date(obj.scheduledFor ?? 0));
      case "draining": return DeploymentStage.draining();
      case "applying": return DeploymentStage.applying();
      case "applied": return DeploymentStage.applied();
      case "failed": return DeploymentStage.failed(obj.reason ?? "Unknown error");
      case "rolled_back": return DeploymentStage.rolledBack();
    }
  }

  toString(): string {
    return this.variant.tag;
  }
}
