/**
 * API Route Factory - Reduces boilerplate for common CRUD operations
 *
 * This factory provides standardized handlers for:
 * - Authentication (via withAuth or withApiAuth)
 * - Error handling with service-specific error codes
 * - Not-found checks for [id] routes
 * - Consistent response formatting
 */

import { NextResponse } from "next/server";
import { withAuth, withApiAuth, errorResponse, parseJsonBody } from "./api";

type RouteContext = {
  userId: string;
  params?: Record<string, string>;
};

type ServiceError = Error & { code?: string };

/**
 * Handles service-level errors consistently across all API routes.
 * Extracts error codes from custom service errors and returns appropriate HTTP status.
 */
export function handleServiceError(
  error: unknown,
  defaultMessage: string
): NextResponse {
  console.error(defaultMessage, error);

  if (error instanceof Error && "code" in error) {
    const serviceError = error as ServiceError;
    const code = serviceError.code ?? "UNKNOWN";
    const status = code === "NOT_FOUND" ? 404 : 400;
    return errorResponse(serviceError.message, status, code);
  }

  return errorResponse(defaultMessage, 500);
}

/**
 * Configuration for creating CRUD handlers
 */
export interface CrudConfig<T> {
  /** Display name of the entity (e.g., "Template", "Recording") */
  entityName: string;

  /** Service functions for CRUD operations */
  service: {
    /** List all entities for a user */
    list?: (userId: string) => Promise<T[]>;
    /** Get a single entity by ID */
    get?: (id: string, userId: string) => Promise<T | null>;
    /** Create a new entity */
    create?: (userId: string, data: unknown) => Promise<T>;
    /** Update an existing entity */
    update?: (id: string, userId: string, data: unknown) => Promise<T | null>;
    /** Delete an entity, returns true if found and deleted */
    delete?: (id: string, userId: string) => Promise<boolean>;
  };

  /** Use withApiAuth instead of withAuth (supports both session and API key auth) */
  requiresApiAuth?: boolean;

  /** Custom response transformers */
  transform?: {
    /** Transform list response (default: { [plural(entityName)]: items }) */
    list?: (items: T[]) => unknown;
    /** Transform single entity response (default: entity as-is) */
    get?: (item: T) => unknown;
    /** Transform created entity response (default: entity as-is) */
    create?: (item: T) => unknown;
  };
}

/**
 * Creates standardized GET handler for listing entities.
 * Used in route.ts (collection endpoint, no params.id).
 */
export function createListHandler<T>(config: CrudConfig<T>) {
  const wrapper = config.requiresApiAuth ? withApiAuth : withAuth;

  return wrapper(async (_request: Request, { userId }: RouteContext) => {
    try {
      if (!config.service.list) {
        return errorResponse("List operation not supported", 405);
      }

      const items = await config.service.list(userId);
      const pluralName =
        config.entityName.toLowerCase() +
        (config.entityName.endsWith("s") ? "" : "s");
      const response = config.transform?.list?.(items) ?? {
        [pluralName]: items,
      };
      return NextResponse.json(response);
    } catch (error) {
      return handleServiceError(
        error,
        `Failed to list ${config.entityName.toLowerCase()}s`
      );
    }
  });
}

/**
 * Creates standardized POST handler for creating entities.
 * Used in route.ts (collection endpoint).
 */
export function createCreateHandler<T>(
  config: CrudConfig<T>,
  validate?: (data: unknown) => string | null
) {
  const wrapper = config.requiresApiAuth ? withApiAuth : withAuth;

  return wrapper(async (request: Request, { userId }: RouteContext) => {
    try {
      if (!config.service.create) {
        return errorResponse("Create operation not supported", 405);
      }

      const result = await parseJsonBody(request);
      if ("error" in result) return result.error;

      // Run custom validation if provided
      if (validate) {
        const validationError = validate(result.data);
        if (validationError) {
          return errorResponse(validationError, 400, "VALIDATION_ERROR");
        }
      }

      const item = await config.service.create(userId, result.data);
      const response = config.transform?.create?.(item) ?? item;
      return NextResponse.json(response, { status: 201 });
    } catch (error) {
      return handleServiceError(
        error,
        `Failed to create ${config.entityName.toLowerCase()}`
      );
    }
  });
}

/**
 * Creates standardized GET handler for fetching a single entity.
 * Used in [id]/route.ts (individual resource endpoint).
 */
export function createGetHandler<T>(config: CrudConfig<T>) {
  const wrapper = config.requiresApiAuth ? withApiAuth : withAuth;

  return wrapper(
    async (_request: Request, { userId, params }: RouteContext) => {
      try {
        if (!config.service.get) {
          return errorResponse("Get operation not supported", 405);
        }

        const id = params?.id;
        if (!id) {
          return errorResponse(
            `${config.entityName} ID is required`,
            400,
            "MISSING_ID"
          );
        }

        const item = await config.service.get(id, userId);
        if (!item) {
          return errorResponse(`${config.entityName} not found`, 404);
        }

        const response = config.transform?.get?.(item) ?? item;
        return NextResponse.json(response);
      } catch (error) {
        return handleServiceError(
          error,
          `Failed to get ${config.entityName.toLowerCase()}`
        );
      }
    }
  );
}

/**
 * Creates standardized PATCH handler for updating an entity.
 * Used in [id]/route.ts (individual resource endpoint).
 */
export function createUpdateHandler<T>(
  config: CrudConfig<T>,
  validate?: (data: unknown) => string | null
) {
  const wrapper = config.requiresApiAuth ? withApiAuth : withAuth;

  return wrapper(
    async (request: Request, { userId, params }: RouteContext) => {
      try {
        if (!config.service.update) {
          return errorResponse("Update operation not supported", 405);
        }

        const id = params?.id;
        if (!id) {
          return errorResponse(
            `${config.entityName} ID is required`,
            400,
            "MISSING_ID"
          );
        }

        const result = await parseJsonBody(request);
        if ("error" in result) return result.error;

        // Run custom validation if provided
        if (validate) {
          const validationError = validate(result.data);
          if (validationError) {
            return errorResponse(validationError, 400, "VALIDATION_ERROR");
          }
        }

        const item = await config.service.update(id, userId, result.data);
        if (!item) {
          return errorResponse(`${config.entityName} not found`, 404);
        }

        return NextResponse.json(item);
      } catch (error) {
        return handleServiceError(
          error,
          `Failed to update ${config.entityName.toLowerCase()}`
        );
      }
    }
  );
}

/**
 * Creates standardized DELETE handler for removing an entity.
 * Used in [id]/route.ts (individual resource endpoint).
 */
export function createDeleteHandler<T>(config: CrudConfig<T>) {
  const wrapper = config.requiresApiAuth ? withApiAuth : withAuth;

  return wrapper(
    async (_request: Request, { userId, params }: RouteContext) => {
      try {
        if (!config.service.delete) {
          return errorResponse("Delete operation not supported", 405);
        }

        const id = params?.id;
        if (!id) {
          return errorResponse(
            `${config.entityName} ID is required`,
            400,
            "MISSING_ID"
          );
        }

        const deleted = await config.service.delete(id, userId);
        if (!deleted) {
          return errorResponse(`${config.entityName} not found`, 404);
        }

        return NextResponse.json({ success: true });
      } catch (error) {
        return handleServiceError(
          error,
          `Failed to delete ${config.entityName.toLowerCase()}`
        );
      }
    }
  );
}

/**
 * Creates all handlers for a collection route (route.ts).
 * Returns GET (list) and POST (create) handlers.
 */
export function createCollectionHandlers<T>(
  config: CrudConfig<T>,
  validation?: {
    create?: (data: unknown) => string | null;
  }
) {
  return {
    GET: createListHandler(config),
    POST: createCreateHandler(config, validation?.create),
  };
}

/**
 * Creates all handlers for a resource route ([id]/route.ts).
 * Returns GET, PATCH, and DELETE handlers.
 */
export function createResourceHandlers<T>(
  config: CrudConfig<T>,
  validation?: {
    update?: (data: unknown) => string | null;
  }
) {
  return {
    GET: createGetHandler(config),
    PATCH: createUpdateHandler(config, validation?.update),
    DELETE: createDeleteHandler(config),
  };
}
