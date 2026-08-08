import type { ApiErrorBody, ErrorCode } from "@/lib/api-error";

export class ApiError extends Error {
  readonly code: ErrorCode | "UNKNOWN";
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCode | "UNKNOWN",
    message: string,
    status: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  // `new Headers(...)` rather than an object spread: `RequestInit["headers"]` may
  // also be a `Headers` instance (no own enumerable properties, so spreading it
  // yields `{}` and silently drops every caller header) or an array of tuples
  // (which spreads to `{0: [...], 1: [...]}` — invalid header names). Setting
  // content-type only when absent also keeps `FormData` uploads working, where
  // forcing JSON would break multipart boundary negotiation.
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.ok) return body as T;

  const envelope = body as ApiErrorBody | null;
  if (envelope?.error?.code) {
    throw new ApiError(
      envelope.error.code,
      envelope.error.message,
      response.status,
      envelope.error.details,
    );
  }

  throw new ApiError(
    "UNKNOWN",
    `Request to ${path} failed with status ${response.status}`,
    response.status,
  );
}
