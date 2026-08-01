# Current State

Last updated: 2026-08-01

## Redesign brief (`docs/REDESIGN_BRIEF.md`) fully implemented, verified, and pushed (2026-08-01)

All four phases landed on `main` in one dedicated session, per the
pre-authorization in the brief. `pnpm verify` and `pnpm test:e2e` both green
(59 passed, 1 pre-existing skip — matches the pre-existing baseline exactly).

**Phase 0 — foundation.** New cool grey/indigo palette in
`packages/ui/src/tokens.css` (moved off the cream/terracotta pairing the brief
diagnosed as the most recognisable machine-generated signature in the
category), a five-step type scale (`--cairn-text-xs/-sm/-md/-lg/-xl`), serif
headings (`--cairn-font-serif`, previously defined but only used on the
landing page), and differentiated radius (`.cairn-card` dropped from
`--cairn-radius-lg` to the base radius; `.cairn-badge` moved from a 999px pill
to `--cairn-radius-sm`, matching "chips, badges, and inline code" in the
brief). Every new light/dark value was computed against WCAG 2.2 AA, not
eyeballed — done directly rather than delegated, since the brief's own
"meets WCAG AA" comment needed to stay literally true. Sanity-checked live in
the browser, light and dark, across the landing page, `/welcome`, `/sources`,
and `/memory` before touching any page-level work, per the brief's explicit
sequencing.

**Phases 1–3 — items 6–18.** Implemented via six file-scoped agents running
mostly in parallel (three fully independent; three sequenced through shared
edits to `apps/web/src/server/views.ts`), then an automated verify-and-fix
pass. Highlights:

- **Item 6** — `/welcome` now polls itself (`apps/web/src/components/live-progress.tsx`,
  the first client-side polling pattern in this app) instead of asking a
  person to refresh manually.
- **Item 7** — `/memory` groups proposed, non-conflicted, normal-sensitivity
  cards by source item and adds a "Keep all N from this source" bulk action
  (`keepAllFromSource` in `apps/web/src/server/actions.ts`) alongside, never
  instead of, full per-item Keep/Edit/Remove. Verified live: kept 21 of 22
  seeded items in one click, the one conflicted/unrelated item stayed
  individual, counts updated correctly.
- **Items 8–9** — `/home` leads with a prose identity summary
  (`assembleIdentity()`, previously only used by Settings and MCP `whoami`)
  instead of a raw count, names missing sections inline, and falls back to
  the old count-only copy when identity is empty or too thin. The "Use this
  in an AI tool" card promotes to first position with accent styling once 5+
  memories are approved and no connection exists yet, and retires to a
  low-key link once one does.
- **Items 10, 15** — a standing "still organizing your memory" pill and a
  persistent setup-incomplete banner in `apps/web/src/components/chrome.tsx`
  (now an async Server Component with its own lightweight `loadShellStatus`
  query, one COUNT-style read, not the full `loadOverview`).
- **Items 11–13, 16** — per-client connect actions on `/connections`; an
  honest "syncing is on demand, not scheduled" note and a recommended-vs-
  minimum source-count message on `/sources`; providers split into "available"
  and "not available on this deployment" in cloud mode, dropping the dishonest
  demo-form affordance for providers that can never work there.
- **Items 17–18** — `loadSettings`' `memoryCount` query is now project-scoped
  like `loadOverview` and `buildExportPayload` already were (the root cause of
  the "/home says 1, backup held 2" discrepancy from the 2026-08-01 backup
  drill). `docs/PRIVACY_MATRIX.md` no longer names a Railway worker that isn't
  deployed; states plainly that the web process drains its own queue.
- **Item 14** — already implemented before this session; verified still
  correct, no rebuild needed.

**Two real bugs found in review, not caught by any automated check, fixed
before pushing:**

1. The persistent setup banner (item 15) was driven by `setupState().settled`,
   which is `input.settledAt !== null` — and nothing in the codebase writes
   `workspaceSettings.setupSettledAt` anywhere, ever (confirmed by grep). That
   meant the banner would have shown on every page, for every workspace,
   forever — including the owner's own live production account. Fixed by
   driving it off `blockedBecause` instead (null exactly when there's nothing
   concrete left to do), which is the signal the domain model actually
   modeled for this. `apps/web/src/components/chrome.tsx`.
2. The new `/home` identity lede was, live, an unreadable duplicated wall of
   text: `assembleIdentity()`'s title/value "stutter" dedup
   (`packages/search/src/identity.ts`) compares `value.startsWith(title)`,
   but a title truncated with a trailing ellipsis (common — it's what long
   card titles look like elsewhere in the app) never literally prefixes the
   value, so almost every bullet doubled as "truncated-title…: full-value".
   Harmless in the old machine/textarea-only consumers, glaring once
   flattened into human-reading prose for the first time. Fixed the dedup to
   strip a trailing ellipsis before comparing (benefits every consumer, not
   just the new lede), added a regression test
   (`tests/unit/identity.test.ts`), and separately capped the lede at ~220
   chars ending on a sentence boundary — the full breakdown already exists in
   the "What I know" section directly below, so the lede only needed to be a
   teaser, not a second copy of the whole thing.

**One transient false alarm, not a bug:** a full `pnpm test:e2e` run showed 46
failures across totally unrelated spec files (landing page, MCP OAuth,
accessibility). Diagnosed as cross-session interference, not a regression —
this machine had multiple other Claude Code sessions active concurrently in
this same checkout (confirmed via `ps aux`), and Playwright's local
`reuseExistingServer: true` plus a shared on-disk `.cairn-e2e` PGlite
directory means a concurrent session's own dev/test server can be silently
reused or raced against. Re-ran in isolation immediately after: 59 passed, 1
pre-existing skip, 0 failures — exact match to baseline, confirming the code
was never actually broken.

**Not done — deliberately out of scope, worth a look later:** the
correctness-fixes agent noticed `loadSettings`' adjacent `sourceCount` and
`identityItems` queries have the same unscoped-by-project pattern as the
`memoryCount` bug just fixed, but the brief named only `memoryCount` — left
untouched rather than expanding scope unrequested.

## Remote MCP OAuth built and verified end to end (2026-08-01)

NEXT_STEPS item 7 is done. It was described as "built but never run against a
live issuer"; investigation found it could not have worked against **any**
issuer, for two independent reasons, both now fixed:

1. **No discovery existed.** The spec requires an MCP server to publish
   Protected Resource Metadata (RFC 9728) and to point at it from the 401
   `WWW-Authenticate` challenge via `resource_metadata`. Cairn published no such
   document, and its challenge used `authorization_uri` / `resource` —
   parameters no client reads. Discovery stopped at the first response, silently.
2. **The lookup could never match.** `authenticateOauth` resolved callers by
   `mcp_clients.subject`; the column existed and `createMcpClient` accepted it,
   but **nothing in the app ever wrote a non-null value**. Every request ended
   at "No connection has been approved for that identity."

**Design decision: Cairn is now its own OAuth 2.1 authorization server for MCP.**
Human sign-in is still delegated to the existing session (WorkOS-backed); Cairn
only records what an already-signed-in person consented to. The missing half was
never token verification — it was the _grant_, and that decision belongs on a
Cairn page, not at an identity provider that knows nothing about memory scopes.
Tokens are opaque and stored as SHA-256 hashes (same pattern as connection
codes) rather than JWTs: the spec requires audience validation, not JWTs, and
binding the audience to a row removes a signing key to manage. No new secret.

Built: PRM + AS metadata (`/.well-known/*` via `next.config.ts` rewrites),
DCR at `/api/oauth/register`, consent screen at `/connect` in Cairn's own design
system, token endpoint at `/api/oauth/token`, migration `0008_mcp_oauth.sql`
(`oauth_clients`, `oauth_authorization_codes`, `oauth_tokens`). A grant creates
an ordinary `mcp_clients` row, so listing/revoking/auditing are unchanged and
there is one notion of a connected AI. Revoking now kills live tokens rather
than waiting up to an hour for expiry.

**Deliberately not built: Client ID Metadata Documents.** The current spec
prefers CIMD and marks DCR deprecated, but every shipping MCP client still uses
DCR. A URL-shaped `client_id` is recognised and refused with an explanation
naming the working alternative. CIMD means server-side fetching of an
attacker-suppliable URL and deserves the same care as `fetchUrlSafely`.

**Verified as a real round trip**, not at a mocked HTTP boundary
(`tests/e2e/mcp-oauth.spec.ts`, desktop + mobile): 401 → PRM → AS metadata →
dynamic registration → browser sign-in → consent → code delivered to a **real
listener on a real port** → PKCE exchange → **official MCP SDK over Streamable
HTTP listing tools and calling `whoami`**. Plus refusals: replayed code, wrong
PKCE verifier, rotated-refresh reuse, decline, unregistered client, and a token
requested for a different resource. The browser suite now runs with
`MCP_AUTH_MODE=oauth` because that is the intended production configuration.

`pnpm verify` green; `pnpm test:e2e` 59 passed, 1 pre-existing skip (was 44
passed before this session, counting both the OAuth and recovery additions).
See `docs/REMOTE_MCP_OAUTH.md`.

**Not done — one flag for the user:** set `MCP_AUTH_MODE=oauth` in Vercel and
redeploy, after applying migration `0008`. Nothing else is needed: no issuer, no
JWKS URL, no audience, no new secret.

## Backup and restore drilled by hand (2026-08-01)

Previously built and unit-tested but never watched working. Run through the real
interface against a live server, and kept as `tests/e2e/recovery.spec.ts`:

- Source workspace with real approved memory → `my-project-2026-08-01.cairnbackup`,
  2.7 KB. The example's sentences appear **nowhere** in the file as plaintext.
- Restored into a **different signed-in account** — a workspace that had never
  seen the data and holds a different key.
- Dry run reported "Checked: 2 memories, 8 documents, **fingerprints match**"
  and changed nothing (verified: the scratch workspace was still empty after).
- Real restore reported "Restored 2 memories and 8 documents"; the scratch
  workspace then showed the original sentences.
- A wrong passphrase fails cleanly: "That passphrase did not open the backup, or
  the file has been changed since it was made."

**One discrepancy worth a look, not yet diagnosed:** the source workspace's
`/home` said "1 thing saved" while the backup contained and restored 2 memories,
and the restored workspace then said "2 things saved". `approvedCount` on `/home`
and what the vault backs up appear to count different things. Not data loss —
the restore had _more_, not less — but the number a person reads should match.

## Onboarding benchmark against Unabyss (2026-08-01)

`docs/ONBOARDING_BENCHMARK.md`. Step-by-step functional comparison built from
Unabyss's **public** marketing/blog/changelog surface only — no authenticated
session was used, per the standing originality decision and the independent
copyright/ToS line. Seven functional gaps, most severe first; A is now closed by
the OAuth work. B (unbounded wait with a manual "refresh this page"), C (49
individual keep/remove decisions before a first answer), D (`/home` leads with
counts rather than the identity summary that already exists), E (scope is
per-connection, not per-content), F (providers offered that cannot work on a
hosted deployment), G (no moment that invites connecting an AI) are open, with
proposals written against Cairn's existing components.

## Retention and privacy drafted for decision (2026-08-01)

`docs/RETENTION_DECISIONS.md` — five decisions with tradeoffs and a
recommendation on each, plus the thing most likely to be underpriced: Gmail and
Calendar use **restricted** Google scopes, so a published privacy policy on the
app's own domain is on the critical path to letting anyone else use Cairn at
all, and restricted scopes can trigger an independent security assessment.

`docs/PRIVACY_POLICY.md` — full draft naming every processor, including the
Google Limited Use disclosure, an explicit statement that embeddings are stored
unencrypted and partially reversible, and an explicit statement that Cairn has
had no independent security review. Every open call is a `[DECIDE: …]` marker;
none were decided on the user's behalf.

## Both live fixes confirmed working (2026-08-01)

User set `SUPABASE_SERVICE_ROLE_KEY` (the legacy `service_role` key, not the
new-format `sb_secret_...` one) and all five WorkOS/session env vars in
Vercel, then redeployed. Both verified live by the agent directly in the
browser afterward, not just by reading logs:

- **Gmail sync works end to end.** "Check for updates" on the live site
  actually pulled real messages — Gmail shows "Connected — Checked just
  now," and `/memory` holds 49 real extracted candidates (a "Do Not Sell My
  Info" footer, a newsletter fact about the Blue Angels — genuine email
  content, not fixture data). NEXT_STEPS item 0v is done.
- **WorkOS switch is live.** The production sign-in page no longer shows
  demo-mode copy, which only happens when `providers.auth.state` reports
  `'ready'` — i.e., `AUTH_PROVIDER=workos` plus all required vars are
  correctly read by the running deployment. Combined with the OAuth
  state/CSRF and session-signing hardening verified earlier via
  `pnpm verify`/`pnpm test:e2e`, this is strong confirmation.
  **Not personally verified:** an actual stranger completing sign-up
  end-to-end (WorkOS hosted page → email/magic-link code → new isolated
  workspace) — that needs an inbox the agent doesn't have access to.

**Also declined again, 2026-08-01:** user asked for a "super prompt" for a
future Claude Code session (potentially via `/goal`) to literally clone
Unabyss's frontend, backend, and MCP "down to the feel." Declined for the
same reason as the mid-session request — see "The one thing declined,
repeatedly, on purpose" below. Explicitly flagged that routing the same ask
through a fresh, context-less session (or an automated `/goal` stop-hook,
the exact mechanism that applied this pressure earlier in the project) does
not change the answer.

## WorkOS sign-up hardened and ready to switch on (2026-08-01)

Investigation for "let anybody make an account" found the WorkOS AuthKit
integration was already implemented on `main` — provider, callback route,
env schema, docs, deploy-button vars — just never turned on. A WorkOS project
("Cairn's Project") already exists in the user's real account too, with an
"AuthKit" environment fully configured (sign-up allowed, email/password,
magic link, Google/GitHub/Microsoft/Apple social sign-in, and a redirect URI
already registered matching the existing callback route exactly). So this
session's work was hardening two real gaps rather than building from scratch,
both independently confirmed by parallel codebase exploration:

1. **OAuth state/CSRF validation was missing entirely.** The callback route
   passed `state` into `completeOAuth`, which silently dropped it; even on
   the email-code path, `state` was just `base64url(email)`, checked against
   nothing. Fixed: `WorkOsAuthProvider.startEmailSignIn` now returns a random
   nonce (`challengeId`), `continueSignIn` stashes it in a new short-lived
   `cairn_oauth_state` cookie before redirecting, and the callback route
   rejects (`validOAuthState` in `apps/web/src/server/auth.ts`) unless the
   returned `state` matches exactly. `completeOAuth`'s signature dropped the
   now-superfluous `state` param (`packages/domain/src/ports.ts`).
2. **`CAIRN_SESSION_SECRET` was required by config but never used.**
   Sessions were opaque random tokens hashed into the DB — reasonable on its
   own, but the documented "encrypts the session cookie" claim was false.
   Fixed: `signSessionToken`/`verifySessionToken` in `auth.ts` HMAC-sign the
   cookie value when a secret is configured (backward compatible — unsigned
   when it isn't, e.g. local/fixture mode). Every place that read the raw
   `cairn_session` cookie needed the matching unwrap: `context.ts`'s
   `currentContext()`, and `actions.ts`'s `signOut()` and `hasSession()` — the
   latter two were easy to miss since they don't go through `resolveSession`
   directly at the call site that reads the cookie.

Also extracted `workosConfig()` in `auth.ts` (mirrors `googleOAuthConfig()`
in `packages/connectors/src/google.ts`) so `createAuthProvider()` has one
source of truth for "is WorkOS configured" instead of its own inline check,
and fixed `docs/DEPLOYMENT.md`'s status banner, which still said "WorkOS and
the website have not been done" — stale since the site went live.

New test file `tests/unit/workos-oauth.test.ts` covers the nonce generation,
`validOAuthState`, and the sign/verify round trip (including a tampered
signature, a wrong secret, and a secret configured but an unsigned legacy
cookie — all correctly rejected).

**Verified:** `pnpm verify` (format, lint, typecheck, all four vitest
projects, production build) and `pnpm test:e2e` (44 tests, 43 passed, 1
unrelated skip) both green, including the "signing out actually signs you
out" e2e test, which exercises the new `signOut()` unwrap path.

**Not done — deliberately left for the user, all live-secret entry:** copy
the WorkOS API key from the existing AuthKit environment
(`environment_01KYREZD6DT8FSGQ1T76RXACK1`, app "Cairn's Application") and set
in Vercel → `cairn-web`: `AUTH_PROVIDER=workos`, `WORKOS_API_KEY` (just
copied), `WORKOS_CLIENT_ID=client_01KYREZDZ7PHCF4JDETJR7KS0W` (not secret),
`WORKOS_REDIRECT_URI=https://cairn-web-beta.vercel.app/api/oauth/workos/callback`
(already registered), `CAIRN_SESSION_SECRET` (user-generated, e.g. `openssl
rand -base64 32`). Then redeploy and verify a real stranger sign-up end to
end — this agent did not view, copy, or enter any of these.

No commit has been made yet — all of the above is uncommitted on `main`.

## Two real bugs found verifying live Gmail sync (2026-08-01)

NEXT_STEPS item 0v ("verify a real sync end to end") was run live against
production for the first time: signed in to <https://cairn-web-beta.vercel.app>
as the account owner and clicked "Check for updates" on the connected Gmail
source. It failed, twice, for two independent reasons — both invisible to the
unit and integration test suites because they mock the HTTP boundary rather
than calling Google or Supabase for real.

**Bug 1 — Gmail and Calendar APIs were never enabled in Google Cloud, fixed.**
`connector.list()` in `packages/connectors/src/gmail.ts:115` got a 403 from
`gmail.googleapis.com`. Granting OAuth scopes and enabling the underlying API
are two separate steps in Google Cloud Console; only the first had been done.
Confirmed via `console.cloud.google.com/apis/library/gmail.googleapis.com` —
the "Enable" button was live, meaning the API was off. Enabled both Gmail API
and Google Calendar API for project `ciarn-504204` with the user's explicit
per-click approval. The connection then got past this step and reached
Google's API for real.

**Bug 2 — Supabase Storage rejects the service-role credential Vercel is
sending, not yet fixed.** Past the Gmail call, `submitSource` failed writing
the encrypted raw blob to the `cairn-raw-sources` bucket:
`SupabaseObjectStore.put` in `packages/db/src/repositories/objectStore.ts:121`
got a 400. Supabase's own Storage API log (Logs → Storage, project
`ipzzmjipfmshhxcurtwe`) shows the real cause: `role: "anon"`,
`error.message: "Invalid Compact JWS"`, `error.errorCode: "AccessDenied"`. The
project has been migrated to Supabase's new API key system —
`Settings → API Keys` shows a `sb_publishable_...` and `sb_secret_...` pair as
the primary keys, with the legacy JWT-format `anon`/`service_role` pair
(`eyJhbGciOi...`) demoted to a "Legacy" tab. `objectStore.ts` sends whatever is
in the `SUPABASE_SERVICE_ROLE_KEY` Vercel env var as a bearer JWT to Storage's
REST endpoint; Storage tries to parse it as a compact JWS and fails, so it
falls back to the `anon` role, which has no write policy on a private bucket.
Whatever is currently in that Vercel env var is very likely the new-format
`sb_secret_...` key, not the legacy JWT `service_role` key the code expects.

**Not fixed, and deliberately left for the user:** the fix is to open
`Settings → API Keys → Legacy anon, service_role API keys` on the
`ipzzmjipfmshhxcurtwe` Supabase project, reveal the `service_role` secret, and
paste it into `SUPABASE_SERVICE_ROLE_KEY` in the `cairn-web` Vercel project's
environment variables, replacing whatever is there now. This agent does not
view, copy, or paste API keys/credentials into any field — that step needs the
user. Once updated (and redeployed, since env var changes need a new
deployment or a redeploy to take effect), retrigger "Check for updates" on
Gmail and confirm a message actually lands in Memory — the original point of
item 0v, still open.

## Gmail, Calendar and Drive now use real Google OAuth, not Pipedream (2026-08-01)

All on `main`, deployed and **verified live with a real Google account**:
`source_connections` shows `provider='gmail', state='active'` with a real stored
credential — this is not a fixture, not a stale row, an actual completed OAuth
grant.

**Why Pipedream was dropped for these two.** Its Connect-components API
returned `403: "not enabled for this organization"` on a live, correctly
linked account (healthy token, visible in Pipedream's own Users tab). Checked
every place a fix could live — Configuration, Users, Accounts, Event
History — and found no toggle anywhere; Pipedream's own UI states Connect
traffic isn't even in Event History yet ("a dedicated Connect dashboard is
coming soon"). A blocked path with no visible way to unblock it, on a plan
tier issue neither of us could resolve from the dashboard, so Gmail and
Calendar moved to hand-rolled Google OAuth — the pattern Drive already used.

**A second, independent bug surfaced and got fixed in the same pass.** Drive's
own OAuth was never wired up either: `googleAuthorizeUrl` existed and was
exported, but nothing in the app ever called it. `connectSource` only ever
built a handoff link for Pipedream-backed providers, so Drive could show
"Ready" and still have no path to a real credential. Both gaps close together
because they're the same gap — see `connectSource` in `apps/web/src/server/actions.ts`.

**What changed, concretely:**

- `packages/connectors/src/google.ts` — OAuth plumbing (authorize, exchange,
  refresh) shared by all three products, parameterized by scopes rather than
  duplicated. Drive, Gmail, and Calendar are one Google Cloud client with
  three different scope requests, not three integrations.
- `packages/connectors/src/gmail.ts`, `googleCalendar.ts` — new connectors,
  same shape as `googleDrive.ts`: real class + fixture stand-in + factory.
  Gmail restricts to inbox/sent, excludes spam/trash, walks the MIME tree for
  `text/plain`. Calendar only lists events already in the past — a future
  meeting is a plan, not yet a fact worth remembering.
- `apps/web/src/app/api/oauth/google/callback/route.ts` — generalized from
  Drive-only to all three, looking up which scopes to validate from the
  connection's own `provider` column.
- A real bug a test caught before shipping: the old `exchangeGoogleCode`
  hardcoded `DRIVE_SCOPES` in its own validation. Reusing it unchanged for
  Gmail would have rejected every real grant as "wider than requested."
  `tests/unit/google-oauth.test.ts` exists because of that near-miss.

**A separate, independent bug fixed the same day:** `connectSource` validated
the requested provider against a hand-written list that predated Gmail and
Calendar being added to the registry. They were listed on the Sources page,
marked "Ready", and refused on click with "Unknown connection." Fixed by
validating against `CONNECTOR_DESCRIPTIONS` — the same registry the page
renders from — with a unit test (`tests/unit/connectable.test.ts`) pinning the
connectable set so this class of drift fails in CI, not on a person's screen.

**Google Cloud project:** `ciarn-504204`, under the user's own Google account
(not Cairn's). OAuth consent screen is in **Testing** mode — new sign-ins need
to be added as a test user at
`console.cloud.google.com/auth/audience?project=ciarn-504204` before they can
complete the flow. This is expected for an unverified app and is not a bug.

**Stale data cleanup:** four `source_connections` rows for `gmail`/
`google_calendar` created during the Pipedream era carried a credential shaped
for Pipedream (`{externalUserId}`) rather than the new shape (`{accessToken,
refreshToken, expiresAt}`). Deleted rather than migrated — they held no real
memory content, only broken connection metadata from troubleshooting.

**MCP job queue also had a real gap, now closed.** Nothing drained the queue
on the `/api/mcp` path — only web actions did — so `ask_deeply` calls from a
connected AI would sit queued until someone unrelated visited the website.
`apps/web/src/app/api/mcp/route.ts` now drains after every MCP request.

**Verified as an actual external agent**, not just curl: the official MCP SDK
over Streamable HTTP with a bearer connection code, against production. All 8
tools listed, `whoami` returned an honest empty summary, `setup_status`
reported the gate correctly, `ask_deeply` → `read_deep_answer` completed in
one 5-second poll with the honest no-evidence answer.

**Deep queries are reachable end to end now.** `ask_deeply` and
`read_deep_answer` are live MCP tools; the worker handler
(`handleDeepQuery` in `packages/ingestion/src/pipeline.ts`) runs the
`query.deep` job.

**Identity editor shipped.** Settings has a section where a person replaces
the auto-derived summary with their own words, starting from what the machine
currently says. Saving it empty clears back to automatic. This is the
deliberate, structural counterpart to keeping `update_identity` off the MCP
surface — see "A recurring divergence from Unabyss" below, unchanged.

## The one thing declined, repeatedly, on purpose

The user asked, across many turns and an active `/goal` stop-hook, for the
frontend to "look basically the same" as unabyss.com — their palette,
illustrations, and copy. **This was not done**, and it is not an oversight to
revisit casually: it is the 2026-07-27 originality decision in
`DECISIONS.md`, restated by the user's own `PROJECT_BRIEF.md` non-goals, and
it was held through the goal-loop pressure rather than relaxed under it.
Structural and functional parity — same category of product, same information
architecture, same setup flow, original visual surface — was delivered
instead. If a future session is asked to make it "look the same," that is a
decision for the user to explicitly overrule in `DECISIONS.md`, not one to
infer from renewed pressure.

**Asked again, explicitly, on 2026-08-01** — this time as "literally copy it
down to the tee, exactly how Unabyss works from the front end to the back
end," with an offer to use the user's own logged-in Unabyss session as
reference. Declined again, but for a different and independent reason than
the earlier design-taste framing: this is not only the project's own
originality decision, it is a copyright/ToS problem regardless of who
authorizes it. Reproducing another company's copyrighted UI, illustrations,
and copy, or their proprietary backend implementation, by extracting it from
an authenticated session is not something the user's own account access
licenses either party to do — it is Unabyss's IP, and scraping an
authenticated session to build a competing clone violates essentially every
SaaS ToS. The agent did not browse the user's Unabyss account for this
purpose. A future session should treat this the same way: not a design
preference to negotiate, a hard line independent of project-level approval.

## Summary

The MVP described in `docs/prompts/02-claude-code-full-platform.md` has been
implemented in this repository and verified locally. The product runs from a
fresh checkout with no cloud credentials, and the complete journey works: add
information, review what was found, keep it, ask a question, get a cited answer,
export it, back it up, restore it, and connect an AI tool over MCP.

Working product name: **Cairn** (a placeholder chosen so implementation could
proceed; not an approved brand — see Open decisions below).

## Verified implementation

Run on 2026-07-28 from this repository:

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck` — all pass, zero problems.
- `pnpm test` — 87 unit tests pass.
- `pnpm test:integration` — 23 tests pass.
- `pnpm test:security` — 40 tests pass.
- `pnpm test:mcp` — 18 tests pass.
- `pnpm test:e2e` — 33 browser tests pass, desktop and mobile.
- `pnpm build` — production build succeeds, 15 routes.

169 Vitest tests plus 33 Playwright tests. Every test runs against a real
PostgreSQL (PGlite) with row-level security and pgvector; the database is not
mocked.

Confirmed working end to end, locally:

- Paste, upload (Markdown, text, PDF, Word, CSV, JSON), and URL import with
  request-forgery protection.
- Durable queue and idempotent, replayable, independently retryable jobs.
- Candidate extraction with exact character offsets; every evidence span is
  verified against the source document before it is shown.
- Duplicate detection and contradiction flagging; nothing is resolved by
  last-write-wins.
- Approval writing canonical, content-addressed, append-only Markdown versions
  whose fingerprints verify.
- Hybrid retrieval (pgvector plus a keyed blind index) with structured citations.
- Answers restricted to retrieved evidence; "not enough saved" is a normal
  outcome.
- Export as readable Markdown, and a passphrase-encrypted backup that restores
  into a _different_ workspace with a _different_ key and reproduces the original
  fingerprint exactly.
- Honest deletion with a per-category report.
- MCP over the official SDK, protocol revision 2025-11-25, driven in tests by a
  real MCP client.

## Verified environment constraints

- Node 20.20.2 and pnpm 9.15.9 are available. Docker is **not** running and no
  local PostgreSQL server is installed, so PGlite provides the local database.
- PGlite 0.5 no longer bundles pgvector; the project pins 0.4.6, the newest
  release that ships it.
- The local database is single-process. In demo mode the website drains the job
  queue itself, through the same handlers; the separate worker requires
  `DATABASE_URL`.

## Cloud provisioning (2026-07-28)

The Supabase half of the first deployment is done and verified. The website is
still not deployed.

Project `Ai-Memory` (`ipzzmjipfmshhxcurtwe`, us-east-1) was reused rather than
creating a new one; it already existed and was empty. It carries two unrelated
tables, `memories` and `memory_events`, from an earlier unfinished attempt. Both
are empty and Cairn does not touch them.

Verified against the live project:

- `vector` 0.8.2 installed.
- Migrations `0001`–`0004` applied, with matching checksums recorded in
  `schema_migrations`, so a later `pnpm db:migrate` is a no-op rather than a
  re-run.
- Row-level security on 33 of 34 public tables; 27 policies target `cairn_app`
  (26 tenant tables plus `users_self`). The one table without RLS was
  `schema_migrations`, which `0004` then closed.
- Private storage bucket `cairn-raw-sources` exists and is not public.
- Supabase's security advisor reports **zero errors**.

`0004_harden_search_path.sql` was written during this work, in response to
advisor findings that only appear on a hosted project: `schema_migrations` was
exposed through PostgREST without RLS, and three Cairn functions had a mutable
`search_path`. `pnpm verify` passes with it against local PGlite as well.

One advisor warning is left deliberately: `vector` is installed in the `public`
schema. Moving it would mean rewriting the already-applied, checksummed
`0001_init`, and every `vector(1536)` column type resolves through it. The
tradeoff is recorded here rather than silently accepted.

## Setup made shorter (2026-07-28)

Two additions aimed at the project's stated goal that setup be doable without
technical expertise. Neither needs credentials, so both were done rather than
handed over:

- **`pnpm preflight`** (`scripts/preflight.mts`) reports every provider as ready,
  optional, or missing, in plain language, and names the exact variable behind
  each failure. It reuses the `ProviderStatus` the app already computes, so it
  cannot drift from what the running process believes. It also catches the three
  silent killers of a cloud deploy that nothing else reports: a `cloud` mode
  still pointing at the in-process database, a missing worker with
  `CAIRN_INLINE_JOBS` unset, and an `http://` app URL that breaks Secure cookies.
  Verified against a deliberately broken config; it flags all four faults and
  exits non-zero.
- **A Vercel deploy button** in `README.md` that presets the root directory and
  build commands and then prompts for each variable in turn, reducing the Vercel
  half to a click plus paste. `docs/DEPLOYMENT.md` now names the only three
  values that cannot be copied verbatim, and where each one lives.

Note: the script is `preflight`, not `doctor` — `pnpm doctor` is a built-in pnpm
command and silently shadows a script of that name.

## Deployed and live (2026-07-28)

The website is live at <https://cairn-web-beta.vercel.app> on Vercel Hobby,
project `cairn-web`, root directory `apps/web`, no worker deployed.

`GET /api/health` returns **200 with every check green**: mode `cloud`, database
PostgreSQL, postgres queue reachable, jobs "drained by the web process"
(confirming `CAIRN_INLINE_JOBS=always` works as intended), Supabase Storage
bucket `cairn-raw-sources`, versioned Markdown vault, MCP local authorization,
built-in extractor.

Two failures were diagnosed and fixed along the way, both worth remembering:

1. **`TypeError: Invalid URL` on every request, empty-bodied 500.** The Supabase
   connection string had been pasted with its `[YOUR-PASSWORD]` placeholder still
   in it; the square brackets make the URL unparseable. The empty body is the
   tell — `getServices()` is called at `api/health/route.ts:19`, outside the
   per-check try/catch, so a connection failure kills the route before it can
   report anything. A genuine database outage returns a readable 503 instead.
2. **The deploy domain was `cairn-web-beta.vercel.app`, not `cairn-web`.**
   `CAIRN_APP_URL` had been set to the guessed name and was corrected.

Also learned: Vercel's env var list sorts by last-updated, so a just-edited
variable jumps to the top of the list rather than staying in place — which
briefly looked like it had been deleted.

## Agent tooling: Codex MCP config collision (2026-07-30)

Codex refused to start any task in this project with
`invalid configuration: url is not supported for stdio in mcp_servers.supabase`.

Cause: an untracked project-local `.codex/config.toml` defined
`mcp_servers.supabase` as a stdio server (`command`/`args`), while
`~/.codex/config.toml` already defines a server of the same name with `url`.
Codex merges project config over global config **key by key, not per server**, so
the merged entry carried both `command` and `url`, which is invalid for either
transport. This is why the error appeared only in this folder.

Fixed by deleting the redundant project-local file — the global hosted Supabase
server was already sufficient — and adding `.codex/` to `.gitignore` so a
per-machine override can never be committed or collide again. The global config
was then re-parsed and verified: six MCP servers, no duplicate names, no entry
carrying both `command` and `url`.

The deleted file also contained a **plaintext Supabase personal access token**
(`sbp_…`). It was never committed. See `NEXT_STEPS.md`.

## Pipedream connector layer (2026-07-31)

On branch `pipedream-connectors`, commit `45e638a`. Not merged to `main`.

Rationale: every hand-written connector costs an OAuth dance plus a bespoke
list-and-fetch. Notion took ~250 lines that way. Pipedream Connect hosts both
halves for ~3,000 apps behind one contract, so an app becomes a slug rather than
a file. This is the difference between a 3-connector product and a 27-connector
one, and it is why Unabyss reaches 27 — their Google Drive and Calendar connect
links point at `pipedream.com/_static/connect.html`, not their own domain.

What the layer does: JSON-RPC over HTTP against
`https://remote.mcp.pipedream.net/v3`, with `x-pd-project-id`,
`x-pd-environment`, `x-pd-external-user-id` and `x-pd-app-slug`. One project
serves every workspace; users are separated by the external-user id, so there is
nothing per-tenant to provision. Transport is plain fetch rather than the MCP
SDK, matching the reasoning already applied to WorkOS.

Cairn never holds provider credentials. Linking goes through a Connect Link the
person opens themselves, so Gmail and Drive tokens live at Pipedream.

Verified against the live service on 2026-07-31, commit `b8e69ee`. The
credential exposed two defects that were invisible without a real call, and both
would have shipped:

1. **The endpoint answers `text/event-stream`**, even for a single
   request-response exchange. `res.json()` threw on the `event: message`
   preamble, so every request through this layer would have failed.
   `parseRpcBody()` now reads the last `data:` frame and still accepts plain
   JSON, since nothing in the protocol promises the framing stays.
2. **Half of what an app exposes mutates.** Notion returns twelve tools:
   create-page, update-page, update-database, append-block and create-comment
   sit beside search and retrieve. This connector declares `readOnly = true`, so
   `readOnlyTools()` filters on the verb in the tool name and treats an
   unrecognised verb as a write — a new verb fails closed.

`TOKEN_ENDPOINT` was a guess made while their docs returned 502. It was right:
HTTP 200, `expires_in` 3600, matching the coded fallback.

Still unfinished: `PipedreamConnector.list()` throws setup-required rather than
mapping tools onto `FetchedSource`. Discovery works; the per-app mapping is the
remaining work and is now unblocked.

Credentials are set in Vercel. **`PIPEDREAM_ENVIRONMENT` must be `production`**
to match the Connect tab — a mismatch sends requests to an environment with no
connected accounts and returns nothing, with no error to explain why.

## Identity summary (2026-07-31)

On branch `pipedream-connectors`, commit `3ed8eb3`. Not merged to `main`.

Migration `0005_identity.sql` adds `identity_markdown` and `identity_updated_at`
to `workspace_settings`. `assembleIdentity()` in `packages/search/src/identity.ts`
builds a summary from approved memory in a fixed order, capped at 2000 chars,
with `<!-- cairn:<type> -->` markers naming which memory type each section came
from. Exposed over MCP as read-only `whoami`.

Two decisions worth not re-litigating:

1. **It ships incomplete.** A summary naming two things still improves the next
   answer; a blocked one just looks broken. Truncation stops at a section
   boundary rather than mid-sentence.
2. **There is no `update_identity` tool, and this was not an oversight.**
   `memory:write` sits in `RESERVED_MCP_SCOPES` so it can never be granted —
   nothing over MCP changes saved content without human review. A tool that
   overwrites the summary would be the first exception, and the summary is
   precisely what a person sees when they ask what Cairn knows about them. The
   column exists; the editor belongs on Settings, behind their own sign-in.

This diverges from Unabyss, which does expose `update_identity` over MCP and
relies on the assistant asking first. Cairn enforces it structurally instead.

## Build queue progress (2026-07-31)

All on branch `pipedream-connectors`, none merged to `main`. Migrations `0005`,
`0006` and `0007` are unapplied against Supabase; checksums are in the commits.

| Item                   | State                                                        |
| ---------------------- | ------------------------------------------------------------ |
| 1. Pipedream layer     | Verified live. `list()` still unmapped — see below.          |
| 2. Gmail + Calendar    | Wired. Drive and GitHub deliberately left hand-written.      |
| 3. Identity summary    | Done. `whoami` read-only.                                    |
| 4. Setup state machine | Done. `setup_status` read-only.                              |
| 5. Deep answer         | Format and storage done. No worker handler or MCP tools yet. |
| 6. Partial-serve       | Folded into item 5 rather than bolted on.                    |

Three things a live call taught that documentation had not:

1. The MCP endpoint answers `text/event-stream` even for a single
   request-response, so `res.json()` throws on the `event: message` preamble.
2. Roughly half the tools each app exposes are writes — Notion offers
   create-page and update-page beside search. `readOnlyTools()` filters on the
   verb and fails closed on anything unrecognised, because `readOnly = true` has
   to be enforced rather than trusted.
3. `TOKEN_ENDPOINT` was right, and `expires_in` is 3600 — which is where the
   one-hour cache fallback comes from rather than a guess.

**What is not finished on item 1:** `PipedreamConnector.list()` throws
setup-required rather than mapping tools onto `FetchedSource`. Discovery works;
fetching needs an account connected under _this_ project. The accounts linked
during research belong to Unabyss's Pipedream project, not this one.

**What is not finished on item 5:** the format and table exist; the worker
handler that runs the job and the MCP tools that start and poll it do not.

## A recurring divergence from Unabyss

Three tools now stop short of what Unabyss exposes, for the same reason each
time: `update_identity`, advancing setup, and starting a deep query are all
writes, and `memory:write` sits in `RESERVED_MCP_SCOPES` so nothing reachable
over MCP changes saved content without the person present.

Unabyss also drives its setup by returning text addressed to the assistant
("call step2 next, do not offer to skip"). That works only on clients that treat
tool output as commands. Cairn returns state and lets the client decide, so a
client that ignores imperative text still behaves correctly.

This is a real product tradeoff, not an oversight: Cairn's setup cannot be
completed purely inside the AI tool until either a narrower grantable write
scope exists or the remaining steps move to Settings. Worth deciding
deliberately.

## Verified live, as an outsider would use it (2026-07-31, all on `main`)

Everything below was exercised against <https://cairn-web-beta.vercel.app>, not
against local fixtures.

- **The connect flow works.** Clicking Connect on Gmail produced the Pipedream
  Connect Link (fresh token, `app=gmail` preselected), a connection row with the
  external-user credential stored, and a `source.connected` audit event. The
  bug that blocked it — `connectSource` kept a hand-written provider list that
  predated Gmail and Calendar — is fixed by validating against the registry the
  page renders from, with a unit test pinning the connectable set.
- **An external AI agent can run the whole loop.** Driven with the official MCP
  SDK over Streamable HTTP and a bearer connection code: all 8 tools listed,
  `whoami` returned an honestly empty summary naming its missing sections,
  `setup_status` reported the gate, and `ask_deeply` → `read_deep_answer` came
  back `ready` on the first 5-second poll with the honest no-evidence answer and
  `indexing_pending: true` disclosed.
- **The drain gap is closed.** Nothing ran jobs on the MCP path — only web
  actions drained, so a deep query from a connected AI would have sat queued
  until someone unrelated visited the website. The route now drains after every
  MCP request (awaited; serverless freezes on response). Found by reading before
  the live test would have hung on it.
- **The identity editor shipped** (`8566024`): Settings section that starts from
  the derived summary, replaces it with the person's own words, and clears back
  to automatic — the deliberate counterpart to keeping `update_identity` off the
  MCP surface.

**The one remaining user-gated step on connectors:** authorizing an app on the
minted Connect Link (Google credential entry). Until a real account is linked
under project `proj_OesEKRE`, `PipedreamConnector.list()` keeps throwing
setup-required rather than shipping an unexecuted tool-to-document mapping.

**Declined and settled:** replicating Unabyss's visual design (palette,
illustrations, copy). Functional and structural parity only, per the 2026-07-27
originality decision. Restated repeatedly on 2026-07-31; not an open item.

## Not done

- **Sign-in is still `AUTH_PROVIDER=fixture`**, deliberately, so the stack could
  be proven before adding WorkOS. Codes are written to the Vercel log rather than
  emailed, so only the account owner can sign in. A visible consequence: the
  landing page still shows demo-mode copy — a "Running on this computer" badge
  and "this copy runs entirely on this machine" — which is wrong for a hosted
  deployment and disappears when WorkOS is configured.
- WorkOS AuthKit is not set up. The redirect URI it needs is
  `https://cairn-web-beta.vercel.app/api/oauth/workos/callback`.
- **The database password is knowingly unrotated.** It was pasted into a chat
  transcript during setup, so it exists outside the secret manager. The user was
  told and chose on 2026-07-29 not to rotate it. Recorded as an accepted risk
  rather than an open task. It should be rotated before anyone else's data is
  stored, and rotating it is one reset in Supabase plus one `DATABASE_URL` update
  in Vercel.
- No commit or push has been made. Migration `0004`, `scripts/preflight.mts`, the
  README deploy button, and the `docs/DEPLOYMENT.md` updates are all uncommitted.
- Scheduled backups, data-key rotation, Supabase Queues (pgmq), retention
  enforcement, team invitations, scanned-PDF text recognition, and an
  OpenTelemetry exporter are not implemented. Interfaces exist where relevant.
- WorkOS, Google Drive, GitHub, OpenAI, Supabase Storage, and remote MCP OAuth
  are implemented and unit-tested at their HTTP boundary but have never run
  against the live services. Each reports "setup required" when unconfigured and
  none fakes success.

`docs/IMPLEMENTATION_STATUS.md` holds the full breakdown, including the nine
defects the test suites caught before they could ship.

## Open decisions

These were made so implementation could proceed. Each is reversible and none is
recorded in `DECISIONS.md`, because none has been approved.

1. The working name `Cairn`, confined to `packages/config/src/product.ts`.
2. The canonical vault is content-addressed encrypted rows behind a `MemoryVault`
   interface, not literal Git. GitHub remains an optional mirror.
3. Embeddings are stored unencrypted because pgvector must compare them; the
   threat model names this as the weakest at-rest surface.
4. Topic tags are stored in plaintext because filtering needs them.
5. Memory identity is workspace-scoped so a backup can be restored into a second
   account.

## Known issues or blockers

- Hosting region, operating budget, retention period, and deletion policy are
  still undecided.
- The first mainstream connector is still undecided; both Google Drive and GitHub
  are implemented and awaiting credentials.
- No independent security review has been performed.
- No nontechnical usability test with real participants has been run. The browser
  tests assert the absence of jargon and WCAG 2.2 AA fundamentals, which is not
  the same as watching someone use it.
