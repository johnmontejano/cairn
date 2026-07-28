import { NextResponse, type NextRequest } from 'next/server';

/**
 * Content Security Policy, with a per-request nonce.
 *
 * A static `script-src 'self'` looks stricter but is wrong here: the framework
 * emits a small inline bootstrap script on every page, and blocking it means the
 * page never becomes interactive — which is exactly the failure this policy is
 * meant to prevent someone else from causing. A fresh nonce per request keeps
 * `unsafe-inline` out while letting the application's own scripts run.
 *
 * `strict-dynamic` lets those nonced scripts load the chunks they need without
 * having to enumerate every one.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDevelopment = process.env.NODE_ENV !== 'production';

  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    // Styles come from the framework's injected <style> tags; there is no
    // per-request nonce path for those, and a stylesheet cannot exfiltrate data
    // the way a script can.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${isDevelopment ? ' ws: http://localhost:* http://127.0.0.1:*' : ''}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(isDevelopment ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  // Only document requests need a nonce, and only they can use one. Rewriting the
  // request of a form post re-issues it, which loses the server-action identity
  // carried in its body — the symptom is a form quietly invoking the wrong
  // action. Non-GET requests therefore get the policy on the response only.
  if (request.method !== 'GET') {
    const passthrough = NextResponse.next();
    passthrough.headers.set('content-security-policy', policy);
    return passthrough;
  }

  // Next reads the nonce back off the request header and stamps it onto the
  // scripts it emits, so both halves have to be set.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', policy);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, which carry no scripts of their own.
    {
      // API responses execute no scripts, so they need no nonce — and passing
      // their requests through this layer was observed to disturb form posts.
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
