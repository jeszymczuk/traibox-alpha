export function safeReturnPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.includes('\0')) return fallback;
  try {
    const parsed = new URL(value, 'https://return-path.invalid');
    if (parsed.origin !== 'https://return-path.invalid' || parsed.pathname.startsWith('/api/auth/')) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function requestOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  }
  const referer = request.headers.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function assertSameOrigin(request: Request, allowedOrigins: ReadonlySet<string>): void {
  const origin = requestOrigin(request);
  if (!origin || !allowedOrigins.has(origin)) throw new BrowserSecurityError(403, 'invalid_origin', 'Request origin was rejected');
}

export class BrowserSecurityError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
