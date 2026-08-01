# Remote MCP authorization

Date: 2026-08-01. Supersedes the `MCP_AUTH_MODE=oauth` design described in
earlier revisions of `docs/DEPLOYMENT.md`.

## What was wrong before

`NEXT_STEPS.md` listed this as "built but never run against a live issuer."
That understated it. The previous implementation could not have worked against
any issuer, for two independent reasons:

1. **There was no discovery.** A client that meets a `401` learns where to send
   someone to sign in from the `WWW-Authenticate` challenge, which must carry a
   `resource_metadata` parameter pointing at an RFC 9728 Protected Resource
   Metadata document. Cairn served no such document, and its challenge used
   `authorization_uri` and `resource` — parameters no client reads. Discovery
   therefore stopped at the first response, silently. Every individual piece
   looked correct in isolation, which is why unit tests passed.

2. **The lookup could never match.** `authenticateOauth` resolved a caller by
   `mcp_clients.subject`. The column existed and `createMcpClient` accepted it,
   but nothing in the application ever wrote a non-null value, so every request
   ended at "No connection has been approved for that identity."

The second is the more interesting failure. Token verification was never the
missing half; the missing half was the **grant** — the moment a person decides
which workspace and which scopes a given AI tool may use. That decision cannot
be delegated to an identity provider, because the provider knows nothing about
memory scopes.

## The design

**Cairn is its own OAuth 2.1 authorization server for MCP access.** Human
sign-in is still delegated exactly as before: the authorize endpoint requires a
live Cairn session, which WorkOS backs. Cairn authenticates nobody here; it
records what an already-signed-in person consented to.

Three consequences follow, and all three are the point:

- The consent screen is a Cairn page in Cairn's own design system, so the
  question a person answers is "let this tool look things up in your memory?"
  rather than an identity provider's generic scope grant.
- Scope and sensitivity are chosen there, per connection, rather than inherited.
- Nothing depends on a plan-tier feature of a third party. The Pipedream
  Connect block earlier in this project was a blocked path with no visible way
  to unblock it; this design has no equivalent single point of refusal.

### Tokens are opaque, not JWTs

The specification requires a resource server to validate a token's **audience**.
It does not require the token to be a JWT. Since Cairn is both the issuer and
the resource server, binding the audience to a row at issue time is a stronger
check than re-parsing a claim, and it removes a signing key to generate,
distribute, rotate, and leak.

It also reuses the pattern already proven here: only a SHA-256 hash is stored,
so a database copy holds nothing replayable — the same rule connection codes
follow.

### What is implemented

| Piece                         | Where                                                   |
| ----------------------------- | ------------------------------------------------------- |
| Protected Resource Metadata   | `/.well-known/oauth-protected-resource` (+ path suffix) |
| Authorization Server Metadata | `/.well-known/oauth-authorization-server`               |
| Dynamic Client Registration   | `POST /api/oauth/register`                              |
| Authorization endpoint        | `GET /connect` — the consent screen                     |
| Token endpoint                | `POST /api/oauth/token`                                 |
| Resource server               | `POST /api/mcp`                                         |

Both well-known paths are served by ordinary route handlers and reached through
rewrites in `next.config.ts`, rather than by a route folder whose name begins
with a dot.

Security properties worth naming, each covered by a test:

- **PKCE S256 only.** OAuth 2.1 removes `plain`, and every MCP client is a
  public client. The verifier is compared in constant time.
- **Authorization codes are single-use**, expire in 60 seconds, and are bound to
  the client, the redirect URI, the PKCE challenge, and the resource together.
- **Refresh tokens rotate, and reuse is treated as theft.** A refresh token that
  has already been rotated should never reappear; when it does, the whole chain
  for that connection is revoked rather than issuing a replacement.
- **Redirect URIs match exactly**, and errors are never redirected to an
  unvalidated one — that is how an open redirector gets built.
- **`iss` on every authorization response** (RFC 9207).
- **403 with `insufficient_scope`**, not 401, when a valid token is too narrow,
  so a client can step up instead of discarding a working token.
- **Revocation is immediate.** Turning a connection off in the website revokes
  its live access tokens rather than waiting up to an hour for expiry.

### What is deliberately not implemented

**Client ID Metadata Documents.** The current spec prefers these over Dynamic
Client Registration and marks DCR deprecated. Every MCP client shipping today
still uses DCR, so DCR is what is implemented. A `client_id` that is an HTTPS
URL is recognised and refused with an explanation naming the working
alternative, rather than failing as an unknown client. Implementing CIMD means
fetching an attacker-suppliable URL from the server, which needs the same care
`fetchUrlSafely` applies to URL import; it is worth doing deliberately rather
than as an afterthought.

**Connection codes are not removed.** They remain the path for a tool that
cannot open a browser, and they remain tested.

## How it was verified

`tests/e2e/mcp-oauth.spec.ts`, run against a real server in both desktop and
mobile projects. Not a mock at the HTTP boundary — the actual round trip:

1. An unauthenticated MCP request returns 401 with `resource_metadata`.
2. That document is fetched, its authorization server discovered, and that
   server's metadata fetched.
3. A client registers dynamically.
4. A browser signs in, lands on the consent screen, and approves.
5. The code arrives at a **real listener on a real port** — the way a desktop
   client receives it.
6. The code is exchanged with PKCE for tokens; replaying it fails.
7. The **official MCP SDK**, over Streamable HTTP, lists tools and calls
   `whoami` with the resulting access token.

Plus refusal cases: wrong PKCE verifier, rotated-refresh reuse, declining,
unregistered client, and a token requested for a different resource.

The browser suite now runs with `MCP_AUTH_MODE=oauth`, because that is the
intended production configuration.

## Turning it on

Set `MCP_AUTH_MODE=oauth` in Vercel and redeploy. Nothing else is required —
no issuer, no JWKS URL, no audience, and no new secret.

`MCP_OAUTH_ISSUER` / `MCP_OAUTH_JWKS_URL` / `MCP_OAUTH_AUDIENCE` now describe an
**optional additional** issuer whose tokens will also be accepted. Leave them
unset unless a deployment specifically wants its own identity provider to issue
MCP tokens; that path still requires something to populate `mcp_clients.subject`
and remains inert otherwise.

Migration `0008_mcp_oauth.sql` must be applied first.
