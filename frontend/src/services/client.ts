/**
 * The single HTTP entry point.
 *
 * Holds the access token in memory only — never in localStorage, where any script
 * on the page could read it. The refresh token lives in an HttpOnly cookie the
 * browser sends automatically and JavaScript cannot touch at all.
 *
 * A 401 triggers one refresh attempt, and concurrent 401s share that single
 * attempt: a page with six queries in flight must not fire six rotations, because
 * with rotation-on-use the losers would be replaying a spent token and the server
 * would correctly kill the whole family.
 */

import type { ApiErrorPayload, TokenResponse } from "@/types/api";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export class ApiError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly details: Array<Record<string, unknown>>;
  readonly requestId: string | undefined;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiError";
    this.status = status;
    this.errorCode = payload.error_code;
    this.details = payload.details ?? [];
    this.requestId = payload.request_id;
  }

  /** A 409 is the processing gate refusing — a workflow state to explain to the
   *  user, not a transient failure to retry (AD-2). */
  get isGateBlocked(): boolean {
    return this.status === 409;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Called when refreshing fails and the session cannot be recovered. */
export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler;
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: ApiErrorPayload = {
    error_code: "INTERNAL_ERROR",
    message: response.statusText || "Request failed.",
    details: [],
  };
  try {
    const body = (await response.json()) as Partial<ApiErrorPayload>;
    if (typeof body?.error_code === "string") {
      payload = { ...payload, ...body } as ApiErrorPayload;
    }
  } catch {
    // A non-JSON error body (a proxy or gateway page) keeps the default above.
  }
  return new ApiError(response.status, payload);
}

async function send(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
    credentials: "include",
  });
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return false;
      }
      const body = (await response.json()) as TokenResponse;
      accessToken = body.access_token;
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so every caller awaiting this attempt observes
      // the same result before a new one can start.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();
  return refreshInFlight;
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  options: { retryOnUnauthorised?: boolean } = {},
): Promise<T> {
  const retry = options.retryOnUnauthorised ?? true;
  let response = await send(path, init);

  if (response.status === 401 && retry && !path.startsWith("/auth/refresh")) {
    if (await refreshSession()) {
      response = await send(path, init);
    } else {
      accessToken = null;
      onSessionLost?.();
    }
  }

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, options?: { retryOnUnauthorised?: boolean }) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : null }, options),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : null }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : null }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
