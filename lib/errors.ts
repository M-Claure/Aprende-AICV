/**
 * Domain error taxonomy. Route handlers translate these into consistent JSON
 * error envelopes (see lib/http.ts). Business/domain code throws these instead
 * of returning ad-hoc shapes.
 */
export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "conflict"
  | "ai_validation_error"
  | "not_ready"
  | "service_unavailable"
  | "internal_error";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 422,
  conflict: 409,
  ai_validation_error: 502,
  not_ready: 409,
  service_unavailable: 503,
  internal_error: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const Errors = {
  unauthorized: (msg = "No autorizado") => new AppError("unauthorized", msg),
  forbidden: (msg = "Acceso denegado") => new AppError("forbidden", msg),
  notFound: (msg = "Recurso no encontrado") => new AppError("not_found", msg),
  validation: (msg = "Datos inválidos", details?: unknown) =>
    new AppError("validation_error", msg, details),
  conflict: (msg = "Conflicto") => new AppError("conflict", msg),
  aiValidation: (msg = "La respuesta de la IA no es válida", details?: unknown) =>
    new AppError("ai_validation_error", msg, details),
  notReady: (msg = "El perfil no está listo", details?: unknown) =>
    new AppError("not_ready", msg, details),
  serviceUnavailable: (
    msg = "Sin conexión a internet. Esta aplicación requiere conexión para funcionar.",
    details?: unknown,
  ) => new AppError("service_unavailable", msg, details),
  internal: (msg = "Error interno") => new AppError("internal_error", msg),
};

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
