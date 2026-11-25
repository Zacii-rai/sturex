// In-memory CSRF and optional Bearer fallback token (never stored in localStorage)
let csrfTokenMemory = '';
let bearerTokenMemory = '';

export function setAuthTokens(csrf: string | null, bearer?: string | null): void {
  csrfTokenMemory = csrf || '';
  if (bearer !== undefined) {
    bearerTokenMemory = bearer || '';
  }
}

export function clearAuthTokens(): void {
  csrfTokenMemory = '';
  bearerTokenMemory = '';
}

export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  if (!isFormData && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (csrfTokenMemory) {
    headers.set('X-CSRF-Token', csrfTokenMemory);
  }
  if (bearerTokenMemory) {
    headers.set('Authorization', `Bearer ${bearerTokenMemory}`);
  }
  headers.set('X-Requested-With', 'XMLHttpRequest');

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const errData = await response.json();
      if (errData?.error) message = errData.error;
    } catch {
      // Ignore JSON parse error
    }
    throw new Error(message);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json() as Promise<T>;
  }
  return (await response.text()) as unknown as T;
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
}
