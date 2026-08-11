import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, isAppError } from "./errors";

/**
 * Consistent JSON envelopes for all API route handlers.
 * Success: { data: T }
 * Error:   { error: { code, message, details? } }
 */
export function ok<T>(data: T, init?: number | ResponseInit): NextResponse {
  const responseInit = typeof init === "number" ? { status: init } : init;
  return NextResponse.json({ data }, responseInit ?? { status: 200 });
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json({ data }, { status: 201 });
}

/** Parse a JSON request body, tolerating an empty body ({}). */
export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("validation_error", "El cuerpo de la solicitud no es JSON válido");
  }
}

export function errorResponse(error: AppError): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    },
    { status: error.status },
  );
}

/**
 * Wrap a route handler body so any thrown AppError / ZodError / unknown becomes
 * a consistent envelope. Unknown errors are logged server-side and returned as
 * a generic 500 (never leaking internals to the client).
 */
export async function handleRoute(
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (isAppError(err)) {
      return errorResponse(err);
    }
    if (err instanceof ZodError) {
      return errorResponse(
        new AppError("validation_error", "Datos inválidos", err.flatten()),
      );
    }
    console.error("[unhandled route error]", err);
    return errorResponse(new AppError("internal_error", "Error interno"));
  }
}
