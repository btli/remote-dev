/**
 * Typed error for the SOURCE-side migration services (jobs, peers, size
 * preview), mirroring MigrationImportError on the destination side: routes
 * map `status`/`code` straight onto the HTTP response via `instanceof`
 * instead of string-matching error messages.
 *
 * Lives in its own module (rather than migration-service.ts) so
 * migration-file-service can throw it without creating an import cycle
 * (migration-service already imports migration-file-service).
 */
export class MigrationServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "MigrationServiceError";
  }
}
