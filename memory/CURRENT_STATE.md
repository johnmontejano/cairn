# Current State

Last updated: 2026-07-28

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

## Not done

- Nothing has been deployed. No repository, commit, push, cloud resource, or
  external account was created.
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
