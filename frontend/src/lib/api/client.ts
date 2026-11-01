import type { ApiErrorBody, AuthResponse, ValidationIssue } from '@/types/api';

/** Base path of the API. Relative by default so cookies stay first-party behind the dev proxy / nginx. */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '/api/v1').replace(/\/+$/, '');

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue | readonly QueryValue[]>;

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  /** Query-string parameters. `null` / `undefined` values are skipped; arrays repeat the key. */
  query?: QueryParams;
  /** A plain value is sent as JSON; a `FormData` instance is sent as multipart. */
  body?: unknown;
  signal?: AbortSignal;
  headers?: HeadersInit;
}

/** Codes for failures that never reached the API or returned an unusable body. */
export const NETWORK_ERROR_CODE = 'network_error';
export const INVALID_RESPONSE_CODE = 'invalid_response';

/** Thrown for every non-2xx response (and for network failures, with `status === 0`). */
export class ApiError extends Error {
  readonly status: number;
  /** Human-readable message, always a string (422 issues are flattened). */
  readonly detail: string;
  readonly code: string | null;
  /** Field path (e.g. "quantity_kg" or "members.0.quantity_kg") → message, from 422 bodies. */
  readonly fieldErrors: Record<string, string>;

  constructor(
    status: number,
    detail: string,
    options: { code?: string | null; fieldErrors?: Record<string, string>; cause?: unknown } = {},
  ) {
    super(detail, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.code = options.code ?? null;
    this.fieldErrors = options.fieldErrors ?? {};
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }

  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/* ───────────────────────── Session-expiry listeners ───────────────────────── */

type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

/**
 * Subscribe to "the session is gone" — fired when a request returned 401 and the refresh
 * token could not renew it. Returns an unsubscribe function.
 */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

function emitSessionExpired(): void {
  for (const listener of sessionExpiredListeners) listener();
}

/* ─────────────────────────────── URL building ─────────────────────────────── */

function appendQuery(search: URLSearchParams, key: string, value: QueryValue): void {
  if (value === null || value === undefined) return;
  search.append(key, String(value));
}

export function buildUrl(path: string, query?: QueryParams): string {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value as readonly QueryValue[]) appendQuery(search, key, item);
    } else {
      appendQuery(search, key, value as QueryValue);
    }
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

/* ───────────────────────────── Error decoding ─────────────────────────────── */

const STATUS_MESSAGES: Record<number, string> = {
  400: 'The request could not be processed.',
  401: 'Please sign in to continue.',
  403: 'You do not have permission to do that.',
  404: 'We could not find what you were looking for.',
  409: 'That action is no longer possible in the current state.',
  413: 'The file is too large.',
  422: 'Please check the highlighted fields.',
  429: 'Too many attempts. Please wait a few minutes and try again.',
};

function fallbackMessage(status: number): string {
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  if (status >= 500) return 'Something went wrong on our side. Please try again shortly.';
  return 'The request failed. Please try again.';
}

/** Turns a FastAPI/Pydantic `loc` into a form field path, dropping the leading "body"/"query"/"path". */
function fieldPath(loc: ValidationIssue['loc']): string {
  const parts = loc[0] === 'body' || loc[0] === 'query' || loc[0] === 'path' ? loc.slice(1) : loc;
  return parts.map(String).join('.');
}

/** Pydantic prefixes custom validator messages with "Value error, ". */
function cleanIssueMessage(msg: string): string {
  return msg.replace(/^Value error,\s*/i, '');
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'detail' in value;
}

export function toApiError(status: number, body: unknown): ApiError {
  if (!isErrorBody(body)) return new ApiError(status, fallbackMessage(status));

  const code = typeof body.code === 'string' ? body.code : null;
  if (typeof body.detail === 'string') {
    return new ApiError(status, body.detail || fallbackMessage(status), { code });
  }

  if (Array.isArray(body.detail)) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of body.detail) {
      const key = fieldPath(issue.loc) || '_form';
      fieldErrors[key] ??= cleanIssueMessage(issue.msg);
    }
    const first = body.detail[0];
    const detail = body.detail.length === 1 && first ? cleanIssueMessage(first.msg) : fallbackMessage(status);
    return new ApiError(status, detail, { code, fieldErrors });
  }

  return new ApiError(status, fallbackMessage(status), { code });
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }
  return text;
}

/* ─────────────────────────────── Transport ────────────────────────────────── */

/** Paths that must never trigger a refresh-and-retry (they *are* the session endpoints). */
const NO_REFRESH_PATHS = new Set(['/auth/login', '/auth/signup', '/auth/refresh']);

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', query, body, signal, headers } = options;
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');

  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    requestHeaders.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }

  try {
    return await fetch(buildUrl(path, query), {
      method,
      headers: requestHeaders,
      body: payload,
      signal,
      credentials: 'include',
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, 'Could not reach MandiMate. Check your internet connection and try again.', {
      code: NETWORK_ERROR_CODE,
      cause: error,
    });
  }
}

let refreshInFlight: Promise<AuthResponse> | null = null;

/**
 * Exchanges the refresh cookie for a new session. Single-flight: concurrent callers share one
 * request, so a burst of 401s never rotates the refresh token more than once.
 */
export function refreshSession(): Promise<AuthResponse> {
  refreshInFlight ??= (async () => {
    try {
      const response = await send('/auth/refresh', { method: 'POST' });
      const body = await readBody(response);
      if (!response.ok) throw toApiError(response.status, body);
      return body as AuthResponse;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Typed fetch for the MandiMate API: JSON or FormData bodies, query params, cookie credentials and a
 * single transparent refresh-and-retry on `401`. Resolves to `undefined` for `204` responses.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options);

  if (response.status === 401 && !NO_REFRESH_PATHS.has(path)) {
    let refreshed = false;
    try {
      await refreshSession();
      refreshed = true;
    } catch (error) {
      if (isApiError(error) && error.isNetworkError) throw error;
    }
    if (!refreshed) {
      emitSessionExpired();
    } else {
      response = await send(path, options);
      if (response.status === 401) emitSessionExpired();
    }
  }

  const body = await readBody(response);
  if (!response.ok) throw toApiError(response.status, body);
  if (body !== undefined && typeof body === 'string') {
    throw new ApiError(response.status, 'The server sent an unexpected response.', { code: INVALID_RESPONSE_CODE });
  }
  return body as T;
}
