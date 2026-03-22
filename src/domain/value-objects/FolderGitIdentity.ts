/**
 * FolderGitIdentity - Value object for a folder's git identity configuration.
 *
 * Represents the pseudonymous/anonymous git identity override configured
 * for a specific folder. When a folder is marked as "sensitive", commits
 * and pushes are subject to identity validation to prevent doxxing.
 */

import { InvalidValueError } from "../errors/DomainError";

export interface FolderGitIdentityOptions {
  folderId: string;
  gitIdentityName: string | null;
  gitIdentityEmail: string | null;
  isSensitive: boolean;
  boundAccountLogin: string | null;
}

export class FolderGitIdentity {
  readonly folderId: string;
  readonly gitIdentityName: string | null;
  readonly gitIdentityEmail: string | null;
  readonly isSensitive: boolean;
  readonly boundAccountLogin: string | null;

  private constructor(options: FolderGitIdentityOptions) {
    this.folderId = options.folderId;
    this.gitIdentityName = options.gitIdentityName;
    this.gitIdentityEmail = options.gitIdentityEmail;
    this.isSensitive = options.isSensitive;
    this.boundAccountLogin = options.boundAccountLogin;
  }

  static create(options: FolderGitIdentityOptions): FolderGitIdentity {
    if (!options.folderId) {
      throw new InvalidValueError(
        "FolderGitIdentity.folderId",
        options.folderId,
        "Must be a non-empty string"
      );
    }
    return new FolderGitIdentity(options);
  }

  /**
   * Check if this folder has a pseudonymous identity configured.
   */
  hasIdentity(): boolean {
    return !!(this.gitIdentityName || this.gitIdentityEmail);
  }

  /**
   * Check if the identity configuration is valid for a sensitive folder.
   * A sensitive folder requires both name and email to be set.
   */
  isValidForSensitive(): boolean {
    if (!this.isSensitive) return true;
    return !!(this.gitIdentityName && this.gitIdentityEmail);
  }

}
