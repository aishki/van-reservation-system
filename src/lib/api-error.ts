export const ERROR_STATUS = {
  VALIDATION_FAILED: 422,
  NOT_AUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  DRIVER_REQUIRED: 422,
  VERSION_CONFLICT: 409,
  // Upstream auth provider is unreachable or rejected our own credentials — a
  // server-side problem, distinct from a user's bad password (NOT_AUTHENTICATED).
  SERVICE_UNAVAILABLE: 503,
  // Upstream auth provider rate-limited us (its fixed-window cap). Surfaced so
  // the caller sees "try again shortly", not "wrong credentials".
  RATE_LIMITED: 429,
  // An email provider PERMANENTLY refused a message — a rejected recipient, an
  // unverified sender identity, or a suspended account. Distinct from
  // SERVICE_UNAVAILABLE (transient, retryable): a rejected message must not be
  // retried unchanged.
  EMAIL_REJECTED: 422,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: unknown,
): Response {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
  return Response.json(body, { status: ERROR_STATUS[code] });
}
