# Current State

Last updated: 2026-07-30

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
