import { NextResponse } from 'next/server';
import { getServices } from '@cairn/ingestion';
import { DomainError } from '@cairn/domain';
import { CSRF_COOKIE, SESSION_COOKIE, createAuthProvider, signInUser } from '@/server/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * WorkOS AuthKit callback.
 *
 * One redirect URI covers every method the hosted page offers — email code,
 * Google, GitHub, Microsoft, Apple — because WorkOS returns the same
 * `authorization_code` regardless of which one the person used. This route
 * therefore never needs to know how they signed in.
 *
 * Cookies are set on the response rather than through `cookies()` because a
 * route handler that returns a redirect cannot mutate the cookie jar the way a
 * server action can; setting them on the `NextResponse` is what actually
 * survives the 303.
 */
export async function GET(request: Request): Promise<Response> {
  const services = await getServices();
  const url = new URL(request.url);

  const backToSignIn = (message: string) =>
    NextResponse.redirect(`${services.config.appUrl}/?error=${encodeURIComponent(message)}`, 303);

  // WorkOS reports a refusal in the query string rather than by status code.
  if (url.searchParams.get('error')) {
    return backToSignIn('Sign-in was cancelled.');
  }

  const code = url.searchParams.get('code');
  if (!code) return backToSignIn('That sign-in link was incomplete. Please try again.');

  const provider = createAuthProvider(services.handle, services.config);
  if (provider.kind !== 'workos') {
    return backToSignIn('Hosted sign-in is not configured on this server.');
  }

  try {
    const identity = await provider.completeOAuth(code, url.searchParams.get('state') ?? '');
    const session = await signInUser(services.handle, services.keyring, identity, {
      authProvider: provider.kind,
      userAgent: request.headers.get('user-agent'),
    });

    const response = NextResponse.redirect(`${services.config.appUrl}/welcome`, 303);
    const secure = services.config.appUrl.startsWith('https://');

    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      expires: session.expiresAt,
    });
    // Readable by the page so forms can echo it back; that is the double-submit
    // half of the CSRF check and is not a secret on its own.
    response.cookies.set(CSRF_COOKIE, session.csrfToken, {
      httpOnly: false,
      secure,
      sameSite: 'strict',
      path: '/',
      expires: session.expiresAt,
    });
    return response;
  } catch (error) {
    if (error instanceof DomainError) return backToSignIn(error.userMessage);
    throw error;
  }
}
