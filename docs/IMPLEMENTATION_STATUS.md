# Implementation status

Last updated: 2026-07-28

The MVP described in `docs/prompts/02-claude-code-full-platform.md` is
implemented and verified locally. Nothing has been deployed, no external account
was created, and no repository, commit, or push was made.

## Verified

All figures below come from a run on 2026-07-28.

| Check            | Command                 | Result                                     |
| ---------------- | ----------------------- | ------------------------------------------ |
| Format           | `pnpm format:check`     | Pass                                       |
| Lint             | `pnpm lint`             | Pass, 0 problems                           |
| Typecheck        | `pnpm typecheck`        | Pass, 0 errors (packages, worker, website) |
| Unit             | `pnpm test`             | 87 passed                                  |
| Integration      | `pnpm test:integration` | 23 passed                                  |
| Security         | `pnpm test:security`    | 40 passed                                  |
| MCP contract     | `pnpm test:mcp`         | 18 passed                                  |
| Browser          | `pnpm test:e2e`         | 33 passed (desktop + mobile)               |
| Production build | `pnpm build`            | Pass, 15 routes                            |

169 Vitest tests plus 33 Playwright tests. Every one runs against a real
PostgreSQL with row-level security and pgvector; nothing about the database is
mocked.

## Complete

**Authentication and workspaces.** Passwordless email sign-in behind an adapter,
with a WorkOS AuthKit implementation for production and a local implementation
that prints the code rather than pretending to email it. Personal workspace,
projects, membership roles, server-side authorization on every operation through
an explicit `ActorContext`.

**Cloud-backed canonical memory.** Content-addressed, append-only versions with
stable identifiers, parent links, author, reason, timestamp, manifest hash, and
provenance. Immutability enforced by database triggers. Full Markdown export and
a tested restore path. Optional GitHub mirror behind an adapter.

**Security and encryption.** Written threat model. Per-workspace data keys under
envelope encryption, AES-256-GCM from Node's own bindings, associated data
binding every ciphertext to `workspace | purpose | row`. Environment key provider
for local use and a KMS provider for production that fails loudly rather than
downgrading. Connector credentials, raw bodies, chunks, evidence, and memory
values all encrypted. Blind-index exact search rather than a plaintext corpus.
Audit events for every consequential action. Rate limits, CSRF, secure cookies,
nonce-based CSP, strict input validation, tenant isolation, webhook signature
verification. Honest deletion. Spend limits on all metered work.

**Sources and ingestion.** Paste, upload (Markdown, text, PDF, Word, CSV, JSON),
URL import with request-forgery protection, Google Drive and GitHub adapters with
fixture fallbacks. The pipeline authorizes, acknowledges webhooks immediately,
deduplicates three ways, stores an immutable encrypted snapshot, normalizes and
chunks, extracts with exact provenance, detects duplicates and contradictions,
requests review, commits approved Markdown, rebuilds derived data, and shows
understandable progress and failure states. Every job is idempotent, replayable,
independently retryable, and observable.

**Structured memory.** All eight memory types, every required field, evidence
required before approval, supersession and conflict links, extraction method and
model recorded, canonical path and version tracked. Contradictions are never
resolved by last-write-wins.

**AI extraction and local mode.** Provider-neutral interfaces. Deterministic
built-in extractor and embedder. OpenAI adapter using Responses with
`store: false` and `text-embedding-3-small`. Local OpenAI-compatible adapter.
Model, prompt version, schema version, tokens, and estimated cost recorded per
job. Content-hash caching. Model output treated as untrusted: schema-validated
and every evidence span re-verified against the source.

**Search, answers, and citations.** Authorization applied in SQL before any
decryption. Semantic retrieval over pgvector fused with blind-index exact
matching. Structured citations with provider, item, revision, locator, excerpt,
offsets, import time, canonical path, and memory version. Every statement in an
answer maps to a citation; insufficient evidence is a first-class outcome. A
visible "Why do you know this?" on every card and every answer.

**Website.** Home, Sources, Memory, Ask, Connected AIs, History, Settings, plus
a first-run flow. Ordinary language throughout — a browser test asserts that ten
technical terms never appear outside advanced disclosures. Explicit interfaces
for source permissions, sync status and retry, review and conflict resolution,
citation detail, version history, export, backup, restore, deletion, connected-AI
permissions and revocation, privacy mode, and where data goes. WCAG 2.2 AA
fundamentals verified in the browser at desktop and mobile sizes.

**MCP server.** Official SDK, protocol revision 2025-11-25, Streamable HTTP,
stateless. Local connection codes and an OAuth 2.1 path validating signature,
issuer, audience, expiry, and scope intersection. Eight canonical resources and
four tools. Every call audited. No write tool.

**Backup, recovery, portability, deletion.** Versioned encrypted archive with
canonical Markdown, manifests, provenance, and integrity hashes. Export, import,
verification, and dry-run restore. A test performs the full round trip into a
different workspace with a different key and asserts the restored documents hash
to the value recorded before the backup was taken.

**Observability and cost controls.** Structured logs with redaction at the
boundary. Sentry over its plain envelope endpoint, deliberately without the SDK
so no request bodies or breadcrumbs are captured. Job dashboard data. Per-
workspace budgets with hard and soft limits. Health endpoint reporting each
dependency separately.

## Not implemented

| Gap                    | Consequence                                                                            | What it needs                              |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------ |
| Scheduled backups      | Backups are the manual download                                                        | A scheduler; the job type and record exist |
| Data-key rotation      | Master-key rotation works; rotating a _data_ key would require re-encrypting every row | A migration job over the encrypted columns |
| Supabase Queues (pgmq) | The Postgres job table is used, which also works on Supabase                           | An adapter behind the existing interface   |
| Retention enforcement  | The setting is stored but nothing prunes old raw snapshots                             | A scheduled job                            |
| Teams                  | Membership model is ready; there is no invite flow                                     | Invitations and a member interface         |
| Scanned PDFs           | Accepted, and reported as having no readable text                                      | Text recognition                           |
| OpenTelemetry          | The variable is accepted; no exporter is wired                                         | An exporter                                |

## Not exercised against live services

Implemented and unit-tested at their HTTP boundary, but never run against the
real thing, because that needs credentials:

- WorkOS AuthKit sign-in
- Google Drive OAuth and file listing
- GitHub App installation tokens, repository reads, and live webhooks
- OpenAI extraction, embeddings, and answering
- Supabase Storage
- Remote MCP OAuth against a live issuer

Each reports **setup required** when unconfigured. None fakes success.

## Decisions taken during implementation

These were chosen so work could proceed. Each is reversible and none has been
approved as durable.

1. **The working name is `Cairn`.** Confined to `packages/config/src/product.ts`
   and the marketing copy. Renaming is an edit to those.
2. **PGlite is the local database.** A real PostgreSQL build in-process, so tests
   exercise the same SQL — including RLS and pgvector — without Docker.
3. **The canonical vault is content-addressed rows, not literal Git.** Behind the
   `MemoryVault` interface, with GitHub as an optional mirror. This was one of
   the open questions; the interface keeps the alternative available.
4. **Memory identity is workspace-scoped.** Required so a backup can be restored
   into a second account while keeping the identifiers embedded in its Markdown.
5. **Embeddings are stored unencrypted.** pgvector must compare them. Documented
   in the threat model as the weakest at-rest surface.
6. **Topic tags are stored in plaintext.** Needed for filtering; documented.
7. **The demo answerer is extractive.** It cannot invent, which suits a product
   whose premise is evidence.

## Bugs found and fixed by the tests

Recorded because each would have shipped otherwise, and because they show what
the suites are for:

- A Content Security Policy that blocked the framework's own bootstrap script, so
  the interface never became interactive. Now a per-request nonce.
- Pages and route handlers receiving separate module instances, so each opened
  its own local database — export, backup, undo, and the OAuth callback all
  silently lost the session. Now shared through the global scope.
- Nested transactions deadlocking on the single-connection local database.
- A sentence splitter that cut on decimal points, so "£0.62 per kilo" lost its
  figure, and on hard-wrapped lines, so wrapped sentences became fragments.
- Globally unique memory identifiers making a restore into a second account
  impossible.
- Answers assembled from stopword overlap alone, which produced a confident
  answer to a question the memory knew nothing about.
- A two-step sign-in that silently returned to the email box on a wrong code.
- Keeping or removing a memory losing its confirmation along with the card.
- `.env.local` and the data directory resolving differently for the website and
  the CLIs.

## Resuming

Read this file and `memory/CURRENT_STATE.md`, then `memory/NEXT_STEPS.md`. The
next external actions, in order of value and risk, are listed there.
