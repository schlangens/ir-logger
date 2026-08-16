export class ApiError extends Error {
  constructor(message, status, retryAfter) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export async function api(path, options = {}) {
  const isJsonBody = options.body && !(options.body instanceof FormData) && typeof options.body === 'object' && !(options.body instanceof URLSearchParams);
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (isJsonBody && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const opts = {
    credentials: 'same-origin',
    headers,
    ...options,
  };

  if (isJsonBody) opts.body = JSON.stringify(options.body);

  let res;
  try {
    res = await fetch(path, opts);
  } catch (networkError) {
    throw new ApiError('Network error — check your connection.', 0);
  }

  const retryAfter = res.headers.get('Retry-After');
  const raw = await res.text();
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }

  if (res.ok) return body;

  if (res.status === 401 && !options.noRedirect) {
    if (!path.includes('/auth/session')) {
      window.location.href = '/login.html';
      return;
    }
  }

  const message = body && body.error ? body.error : `${res.status} ${res.statusText}`;
  throw new ApiError(message, res.status, retryAfter ? parseInt(retryAfter, 10) : undefined);
}

export function get(path, params, options) {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  return api(url.pathname + url.search, { method: 'GET', ...options });
}

export function post(path, body, options) {
  return api(path, { method: 'POST', body, ...options });
}

export function patch(path, body, options) {
  return api(path, { method: 'PATCH', body, ...options });
}

export function del(path, options) {
  return api(path, { method: 'DELETE', ...options });
}
