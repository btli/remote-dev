/**
 * UpdateDeployment - Entity representing an in-progress auto-update deployment.
 *
 * Tracks the lifecycle of an update from detection through application.
 * Persisted as a singleton row in the database so state survives restarts.
 * Immutable — state changes return new instances.
 */

import { DeploymentStage } from "../value-objects/DeploymentStage";
import type { DeploymentStageTag, DeploymentStagePlain } from "../value-objects/DeploymentStage";

/** Serialized form for persistence (Dates as epoch ms). */
export interface UpdateDeploymentPlain {
  stage: DeploymentStagePlain;
  version: string;
  detectedAt: number;
  scheduledFor: number | null;
  drainStartedAt: number | null;
  appliedAt: number | null;
  failedAt: number | null;
  failureReason: string | null;
}

export interface UpdateDeploymentProps {
  stage: DeploymentStage;
  version: string;
  detectedAt: Date;
  scheduledFor: Date | null;
  drainStartedAt: Date | null;
  appliedAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
}

export class UpdateDeployment {
  private constructor(private readonly props: UpdateDeploymentProps) {}

  /**
   * Create a new deployment when an update is first detected.
   */
  static detected(version: string): UpdateDeployment {
    return new UpdateDeployment({
      stage: DeploymentStage.detected(),
      version,
      detectedAt: new Date(),
      scheduledFor: null,
      drainStartedAt: null,
      appliedAt: null,
      failedAt: null,
      failureReason: null,
    });
  }

  /**
   * Reconstitute from persisted data.
   */
  static reconstitute(props: UpdateDeploymentProps): UpdateDeployment {
    return new UpdateDeployment(props);
  }

  get stage(): DeploymentStage {
    return this.props.stage;
  }

  get stageTag(): DeploymentStageTag {
    return this.props.stage.tag;
  }

  get version(): string {
    return this.props.version;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get scheduledFor(): Date | null {
    return this.props.scheduledFor;
  }

  get drainStartedAt(): Date | null {
    return this.props.drainStartedAt;
  }

  get appliedAt(): Date | null {
    return this.props.appliedAt;
  }

  get failedAt(): Date | null {
    return this.props.failedAt;
  }

  get failureReason(): string | null {
    return this.props.failureReason;
  }

  /**
   * Transition to scheduled stage with a target apply time.
   */
  schedule(scheduledFor: Date): UpdateDeployment {
    return new UpdateDeployment({
      ...this.props,
      stage: DeploymentStage.scheduled(scheduledFor),
      scheduledFor,
    });
  }

  /**
   * Transition to draining stage.
   */
  startDrain(): UpdateDeployment {
    return new UpdateDeployment({
      ...this.props,
      stage: DeploymentStage.draining(),
      drainStartedAt: new Date(),
    });
  }

  /**
   * Transition to applying stage.
   */
  startApply(): UpdateDeployment {
    return new UpdateDeployment({
      ...this.props,
      stage: DeploymentStage.applying(),
    });
  }

  /**
   * Transition to applied stage.
   */
  markApplied(): UpdateDeployment {
    return new UpdateDeployment({
      ...this.props,
      stage: DeploymentStage.applied(),
      appliedAt: new Date(),
    });
  }

  /**
   * Transition to failed stage.
   */
  markFailed(reason: string): UpdateDeployment {
    return new UpdateDeployment({
      ...this.props,
      stage: DeploymentStage.failed(reason),
      failedAt: new Date(),
      failureReason: reason,
    });
  }

  /**
   * Transition to rolled back stage.
   */
  markRolledBack(): UpdateDeployment {
    return new UpdateDeployment({
      ...this.props,
      stage: DeploymentStage.rolledBack(),
      failedAt: new Date(),
      failureReason: this.props.failureReason,
    });
  }

  /**
   * Serialize to a plain object for persistence.
   */
  toPlainObject(): UpdateDeploymentPlain {
    return {
      stage: this.props.stage.toPlainObject(),
      version: this.props.version,
      detectedAt: this.props.detectedAt.getTime(),
      scheduledFor: this.props.scheduledFor?.getTime() ?? null,
      drainStartedAt: this.props.drainStartedAt?.getTime() ?? null,
      appliedAt: this.props.appliedAt?.getTime() ?? null,
      failedAt: this.props.failedAt?.getTime() ?? null,
      failureReason: this.props.failureReason,
    };
  }

  /**
   * Reconstitute from a plain object.
   */
  static fromPlainObject(obj: UpdateDeploymentPlain): UpdateDeployment {
    return UpdateDeployment.reconstitute({
      stage: DeploymentStage.fromPlainObject(obj.stage),
      version: obj.version,
      detectedAt: new Date(obj.detectedAt),
      scheduledFor: obj.scheduledFor ? new Date(obj.scheduledFor) : null,
      drainStartedAt: obj.drainStartedAt ? new Date(obj.drainStartedAt) : null,
      appliedAt: obj.appliedAt ? new Date(obj.appliedAt) : null,
      failedAt: obj.failedAt ? new Date(obj.failedAt) : null,
      failureReason: obj.failureReason,
    });
  }
}
