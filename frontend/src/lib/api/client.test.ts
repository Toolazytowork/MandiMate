import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiFetch, NETWORK_ERROR_CODE, onSessionExpired } from './client';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const USER = { user: { id: 'u1', full_name: 'Ravi Kumar' } };

let fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;

function useFetch(handler: Handler) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init ?? {}));
  vi.stubGlobal('fetch', fetchMock);
}

const calls = () => fetchMock.mock.calls.map(([input, init]) => `${init?.method ?? 'GET'} ${String(input)}`);

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch basics', () => {
  it('sends cookies, JSON bodies and skips empty query values', async () => {
    useFetch(() => json({ ok: true }));
    await apiFetch('/harvests', {
      method: 'POST',
      query: { status: 'listed', crop_id: null, farmer_id: undefined, mine: false, ids: ['a', 'b'] },
      body: { quantity_kg: 400 },
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/harvests?status=listed&mine=false&ids=a&ids=b');
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(init?.body).toBe('{"quantity_kg":400}');
  });

  it('lets the browser set the multipart boundary for FormData', async () => {
    useFetch(() => json({ id: 'p1' }, 201));
    const form = new FormData();
    form.append('file', new Blob(['x'], { type: 'image/png' }), 'photo.png');
    await apiFetch('/harvests/h1/photos', { method: 'POST', body: form });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.body).toBe(form);
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
  });

  it('resolves 204 responses to undefined', async () => {
    useFetch(() => new Response(null, { status: 204 }));
    await expect(apiFetch('/notifications/read-all', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('turns domain errors into ApiError with detail and code', async () => {
    useFetch(() => json({ detail: 'Lot is not open for offers', code: 'lot_not_open' }, 409));
    const error = await apiFetch('/offers', { method: 'POST', body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, detail: 'Lot is not open for offers', code: 'lot_not_open' });
  });

  it('maps 422 validation issues to field errors', async () => {
    useFetch(() =>
      json(
        {
          detail: [
            { loc: ['body', 'quantity_kg'], msg: 'Input should be greater than 0', type: 'greater_than' },
            { loc: ['body', 'members', 0, 'quantity_kg'], msg: 'Value error, Too much', type: 'value_error' },
          ],
        },
        422,
      ),
    );
    const error = (await apiFetch('/lots', { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(422);
    expect(error.fieldErrors).toEqual({
      quantity_kg: 'Input should be greater than 0',
      'members.0.quantity_kg': 'Too much',
    });
    expect(error.detail).toBe('Please check the highlighted fields.');
  });

  it('reports network failures as status 0', async () => {
    useFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const error = (await apiFetch('/crops').catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.code).toBe(NETWORK_ERROR_CODE);
  });
});

describe('apiFetch session refresh', () => {
  it('refreshes once on 401 and retries the original request', async () => {
    let authorised = false;
    useFetch((url) => {
      if (url.endsWith('/auth/refresh')) {
        authorised = true;
        return json(USER);
      }
      return authorised ? json({ id: 'u1' }) : json({ detail: 'Not authenticated' }, 401);
    });

    await expect(apiFetch('/auth/me')).resolves.toEqual({ id: 'u1' });
    expect(calls()).toEqual(['GET /api/v1/auth/me', 'POST /api/v1/auth/refresh', 'GET /api/v1/auth/me']);
  });

  it('shares a single refresh between concurrent 401s', async () => {
    let authorised = false;
    let releaseRefresh: () => void = () => {};
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });

    useFetch(async (url) => {
      if (url.endsWith('/auth/refresh')) {
        await refreshGate;
        authorised = true;
        return json(USER);
      }
      return authorised ? json({ url }) : json({ detail: 'Not authenticated' }, 401);
    });

    const pending = Promise.all([apiFetch('/harvests'), apiFetch('/offers'), apiFetch('/lots')]);
    await vi.waitFor(() => expect(calls().filter((call) => call.includes('/auth/refresh'))).toHaveLength(1));
    releaseRefresh();
    await expect(pending).resolves.toHaveLength(3);

    expect(calls().filter((call) => call.includes('/auth/refresh'))).toHaveLength(1);
    expect(calls()).toHaveLength(7);
  });

  it('gives up and announces session expiry when the refresh fails', async () => {
    useFetch(() => json({ detail: 'Not authenticated' }, 401));
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);

    const error = (await apiFetch('/dashboard/farmer').catch((e: unknown) => e)) as ApiError;
    unsubscribe();

    expect(error.status).toBe(401);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(calls()).toEqual(['GET /api/v1/dashboard/farmer', 'POST /api/v1/auth/refresh']);
  });

  it.each(['/auth/login', '/auth/signup', '/auth/refresh'])('never refreshes for %s', async (path) => {
    useFetch(() => json({ detail: 'Invalid credentials' }, 401));
    const error = (await apiFetch(path, { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError;

    expect(error.detail).toBe('Invalid credentials');
    expect(calls()).toEqual([`POST /api/v1${path}`]);
  });
});
