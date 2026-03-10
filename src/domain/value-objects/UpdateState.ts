/**
 * UpdateState - Value object representing the current state of the update system.
 *
 * States:
 *   idle → checking → available | upToDate | error
 *   available → downloading → applying → (process restart)
 *
 * Each state variant carries only the data relevant to it.
 */

export type UpdateStateTag =
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "downloading"
  | "applying"
  | "error";

export interface UpdateStateIdle {
  tag: "idle";
}

export interface UpdateStateChecking {
  tag: "checking";
}

export interface UpdateStateUpToDate {
  tag: "up_to_date";
}

export interface UpdateStateAvailable {
  tag: "available";
}

export interface UpdateStateDownloading {
  tag: "downloading";
  progress: number; // 0-100
}

export interface UpdateStateApplying {
  tag: "applying";
}

export interface UpdateStateError {
  tag: "error";
  message: string;
}

export type UpdateStateVariant =
  | UpdateStateIdle
  | UpdateStateChecking
  | UpdateStateUpToDate
  | UpdateStateAvailable
  | UpdateStateDownloading
  | UpdateStateApplying
  | UpdateStateError;

export class UpdateState {
  private constructor(private readonly variant: UpdateStateVariant) {}

  static idle(): UpdateState {
    return new UpdateState({ tag: "idle" });
  }

  static checking(): UpdateState {
    return new UpdateState({ tag: "checking" });
  }

  static upToDate(): UpdateState {
    return new UpdateState({ tag: "up_to_date" });
  }

  static available(): UpdateState {
    return new UpdateState({ tag: "available" });
  }

  static downloading(progress: number): UpdateState {
    return new UpdateState({ tag: "downloading", progress: Math.min(100, Math.max(0, progress)) });
  }

  static applying(): UpdateState {
    return new UpdateState({ tag: "applying" });
  }

  static error(message: string): UpdateState {
    return new UpdateState({ tag: "error", message });
  }

  get tag(): UpdateStateTag {
    return this.variant.tag;
  }

  get downloadProgress(): number | null {
    return this.variant.tag === "downloading" ? this.variant.progress : null;
  }

  get errorMessage(): string | null {
    return this.variant.tag === "error" ? this.variant.message : null;
  }

  isIdle(): boolean {
    return this.variant.tag === "idle";
  }

  isAvailable(): boolean {
    return this.variant.tag === "available";
  }

  isUpToDate(): boolean {
    return this.variant.tag === "up_to_date";
  }

  /** Value equality */
  equals(other: UpdateState): boolean {
    if (this.variant.tag !== other.variant.tag) return false;
    if (this.variant.tag === "downloading" && other.variant.tag === "downloading") {
      return this.variant.progress === other.variant.progress;
    }
    if (this.variant.tag === "error" && other.variant.tag === "error") {
      return this.variant.message === other.variant.message;
    }
    return true;
  }

  toString(): string {
    return this.variant.tag;
  }
}
