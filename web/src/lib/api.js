// Server bilan aloqa. Hamma so'rov JSON; xato bo'lsa Error (status bilan).

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Sessiya tugaganda (401) ilova login sahifasiga qaytishi uchun.
let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* bo'sh javob */
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/login') onUnauthorized();
    throw new ApiError(data?.error || `HTTP ${res.status}`, res.status, data?.code);
  }
  return data;
}

export const get = (p) => api(p);
export const put = (p, body) => api(p, { method: 'PUT', body });
export const post = (p, body) => api(p, { method: 'POST', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = (p) => api(p, { method: 'DELETE' });
