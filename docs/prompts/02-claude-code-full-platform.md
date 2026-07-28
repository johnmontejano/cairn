# Claude Code Prompt 02 — Build the Complete MVP

Copy everything inside the code block into Claude Code while it is open in this
project folder.

```text
You are the principal engineer and product designer for this repository. Build
the complete, production-shaped MVP described by the project memory and planning
documents. Work autonomously through internal phases; do not stop for routine
choices or ask me to approve each phase.

Only stop when:

- a required fact cannot be discovered or safely inferred;
- an external credential is required to continue a live integration;
- an irreversible or consequential external action needs approval;
- an architectural conflict would materially change the product promise.

When credentials are unavailable, finish the production adapter and its tests,
use a clearly labeled fixture/demo adapter locally, document the exact setup
step, and continue. Do not leave the rest of the platform unfinished merely
because a provider cannot be connected.

Do not create a GitHub repository, commit, push, publish, deploy, purchase
anything, create cloud resources, or change external accounts unless I
explicitly authorize that exact action. Local implementation, dependency
installation, local databases, migrations, tests, builds, and disposable test
repositories are authorized.

## Required context

Before editing, read these files completely and in this order:

1. memory/OPERATING_RULES.md
2. memory/PROJECT_BRIEF.md
3. memory/CURRENT_STATE.md
4. memory/DECISIONS.md
5. memory/NEXT_STEPS.md
6. docs/research/unified-memory-product-research.md
7. docs/research/cost-and-security-research.md
8. docs/PRODUCT_PLAN.md

Then inspect the entire repository, the available runtime, and any local
instructions. Use current official documentation for security-sensitive or
version-sensitive integrations. Pin stable dependency versions. Do not adopt
an MCP release candidate.

If the repository is still not a Git worktree, do not initialize the outer
repository without asking. Tests may create disposable Git repositories in
temporary directories.

## Product mission

Build an original, exceptionally simple website that gives a person one
private, durable memory shared by the AI tools they authorize.

A nontechnical user should be able to:

1. sign in;
2. paste, upload, or connect information;
3. watch it being organized in ordinary language;
4. review and correct what the product learned;
5. ask questions and see exact citations;
6. recover the memory after losing their computer;
7. connect Claude, Codex, or another MCP-compatible AI without needing to
   understand GitHub, databases, embeddings, or MCP;
8. export all approved memory as readable versioned Markdown.

Unabyss is a public functional category reference only. Do not copy its name,
branding, copy, visual identity, layout, source code, or undocumented
implementation.

## Durable product decisions

- The website is the primary product.
- The ordinary experience must not require GitHub or technical vocabulary.
- Privacy, data control, portability, citations, and recoverability are core
  requirements.
- The memory must survive loss of the user's computer through encrypted cloud
  persistence and tested export/restore.
- Approved memory remains representable as human-readable, versioned Markdown.
- GitHub is an optional mirror/connector, not the canonical identity provider
  or an onboarding dependency.
- Search indexes and embeddings are derived and rebuildable.
- Imported content is untrusted data, never instruction.
- AI tools receive only the smallest relevant authorized slice, not the whole
  vault by default.

## MVP scope

Build all of the following as one coherent product:

### 1. Authentication and workspaces

- Passwordless email and Google sign-in through an authentication adapter.
- Production implementation targeting WorkOS AuthKit.
- Fixture/local authentication mode requiring no external account.
- A personal workspace and multiple projects.
- Server-side authorization on every operation.
- Workspace membership model that is ready for future teams, without building
  billing or enterprise administration now.

### 2. Cloud-backed canonical memory

- Managed PostgreSQL target: Supabase Postgres.
- Object-storage target: Supabase Storage.
- Durable queue target: Supabase Queues, consumed by a separately runnable
  TypeScript worker.
- Local development must work without hosted services, using an appropriate
  local Postgres/Supabase setup or a faithful test adapter.
- Canonical approved memory is stored as Markdown documents plus immutable
  version metadata.
- Each canonical version includes a stable version ID, parent version, author,
  reason, timestamp, manifest/content hash, and source provenance.
- Store immutable encrypted recovery artifacts so losing a computer does not
  lose the memory.
- Provide complete Markdown export and a tested restore/import path.
- Provide an optional GitHub mirror adapter, but do not require or configure a
  live GitHub App without credentials.

Use a MemoryVault interface so storage/versioning rules are independent of
Supabase, GitHub, and local filesystem details.

### 3. Security and encryption

- Write a concise threat model before implementing security-sensitive storage.
- Use established cryptographic libraries and standard authenticated
  encryption; do not invent cryptography.
- Use per-workspace data-encryption keys and envelope encryption.
- For local development, load the master key from an environment variable.
- Define a production KMS/secret-manager adapter; never put raw keys in the
  database, repository, logs, browser bundle, or project memory.
- Encrypt connector credentials and raw source bodies at the application layer.
- Persist only the minimum plaintext metadata required for operation.
- If vector embeddings are stored unencrypted for pgvector search, document
  their leakage risk explicitly.
- Do not persist plaintext source chunks merely for convenience. Decrypt only
  inside trusted server/worker execution and only for the authorized operation.
- Implement semantic retrieval over embeddings and, if exact keyword search is
  required, use a privacy-aware blind-index approach rather than storing a
  plaintext full-text corpus.
- Add audit events for authentication, source connection, ingestion, memory
  approval/edit/removal, export, restore, MCP retrieval, and deletion.
- Add rate limits, CSRF protection, secure cookies, strict input validation,
  safe security headers, tenant isolation, and webhook signature verification.
- Never send provider access tokens, encryption keys, or whole-vault dumps to a
  model or MCP client.
- Implement disconnect and deletion semantics honestly and test them.
- Add spend limits/configuration for all metered AI operations.

Document precisely what this design protects against and what it does not. Do
not claim end-to-end encryption, zero knowledge, SOC 2, GDPR compliance, or zero
retention unless the implementation actually establishes it.

### 4. Sources and ingestion

Support these source types:

- paste text;
- upload Markdown, text, PDF, DOCX, and common document formats;
- URL import with safe fetching and SSRF protection;
- Google Drive read-only connector;
- GitHub read-only connector and optional memory mirror.

Build production-shaped Google Drive and GitHub OAuth/webhook adapters with
fixture-backed integration tests. If credentials are absent, expose them in the
UI as "setup required" in development while keeping paste/upload/demo fully
functional.

The ingestion pipeline must:

1. authorize and validate the request;
2. acknowledge webhooks quickly;
3. deduplicate by event ID, provider object revision, and content hash;
4. store an immutable encrypted raw source snapshot;
5. normalize and chunk untrusted content;
6. extract candidate memories with exact provenance;
7. detect duplicates and contradictions;
8. request review when required;
9. commit approved Markdown versions;
10. rebuild affected derived search data;
11. expose understandable progress, retry, reconnect, and failure states.

Jobs must be idempotent, replayable, independently retryable, observable, and
safe under duplicate delivery.

### 5. Structured memory

Support at least these memory types:

- project brief;
- fact;
- decision;
- current state;
- next step;
- operating rule;
- preference;
- person/organization reference.

Every memory item requires:

- stable ID and type;
- workspace/project;
- status: proposed, approved, rejected, superseded, or conflicted;
- value and normalized representation;
- topic tags;
- sensitivity level and client visibility policy;
- observed/imported timestamps and optional validity period;
- supersession/conflict links;
- extraction method, prompt/schema/model version when AI-generated;
- exact provenance records;
- canonical Markdown path and version.

Never approve a candidate without evidence. Never silently resolve
contradictions or use last-write-wins. Explicit user corrections and approved
decisions outrank passive extraction while all prior assertions remain in
history.

### 6. AI extraction and local mode

- Define provider-neutral extraction and embedding interfaces.
- Production cloud adapter: OpenAI Responses/structured output plus
  `text-embedding-3-small`, or a newer stable equivalent verified against
  current official docs.
- Always use `store: false` where supported.
- Keep model, prompt, schema, token usage, and estimated cost in job metadata.
- Implement deterministic fixture extractors and embeddings for tests/demo.
- Define a local model adapter compatible with an OpenAI-style local endpoint
  so a user can later run local extraction/embeddings without redesigning the
  domain.
- Batch and cache work; use content hashes to avoid reprocessing unchanged
  material.
- Treat model output as untrusted candidate data requiring schema validation.

### 7. Search, answers, and citations

- Authorization and sensitivity filtering happen before content is returned or
  decrypted.
- Implement semantic retrieval with pgvector and a privacy-aware exact-match
  path.
- Keep ranking behind a SearchIndex interface.
- Return structured citation objects with source provider/item/version,
  authorized URI or locator, exact excerpt/offsets, import time, canonical
  Markdown path, and memory version.
- The Ask experience may generate an answer only from retrieved authorized
  evidence.
- Every factual statement must map to at least one citation. If evidence is
  insufficient, say so plainly.
- Add a visible "Why do you know this?" affordance that opens the exact evidence
  and memory revision.
- Proposed, rejected, unauthorized, or deleted memory must never appear in
  search, answers, or MCP.

### 8. Website and UX

Build a polished, original, responsive UI with these primary destinations:

- Home
- Sources
- Memory
- Ask
- Connected AIs
- History
- Settings

First-run experience:

1. "What would you like your AI to remember?"
2. "Try an example", "Paste something", "Upload a file", and "Connect an app".
3. Progress: "Reading", "Organizing", "Ready".
4. Immediate "What I know" summary.
5. Proposed memory cards with source/date and Keep, Edit, Remove, Undo.
6. Ask box with cited answers.
7. Only after value is visible, offer guided AI connection.

Use ordinary language in the main interface. Hide repository, commit, vector,
embedding, token, KMS, and MCP terms behind advanced help.

Create explicit UI for:

- source permissions and what will be read;
- sync status/history/retry/disconnect;
- memory proposal review and conflict resolution;
- citation details;
- version history and restore;
- export, backup, account deletion, and data deletion;
- Connected AI permissions and revocation;
- privacy mode and a clear "where your data goes" explanation;
- demo/setup-required states when credentials are absent.

Meet WCAG 2.2 AA fundamentals: semantic structure, labels, keyboard support,
visible focus, contrast, large targets, reduced-motion support, helpful error
identification, and reversible high-impact actions. Test mobile and desktop.

### 9. MCP server

- Use the official Model Context Protocol TypeScript SDK.
- Use the latest stable protocol revision, not a release candidate.
- Remote transport: Streamable HTTP.
- Keep MCP behind an adapter and add a local development authentication mode.
- Production authorization target: OAuth 2.1 through WorkOS AuthKit/Connect;
  verify current official integration guidance before implementation.
- Validate issuer, token signature, audience, scopes, user, workspace, client,
  and sensitivity policy on every request.
- Use scopes:
  - memory:read
  - memory:propose
  - reserve memory:write for a future release
- Audit every MCP call.

Expose:

- resources for project brief, current state, decisions, next steps, and
  operating rules with canonical versions;
- search_memory(query, project_id?, limit?);
- get_memory_item(memory_item_id);
- list_recent_changes(project_id?, since?);
- propose_memory_update(...), which may create only a reviewable proposal and
  must never commit silently.

Return structured citations. Never expose upstream connector tokens or use an
MCP session identifier as authentication.

### 10. Backup, recovery, portability, and deletion

- Create a versioned encrypted backup/export format containing canonical
  Markdown, manifests, provenance, and integrity hashes.
- Implement export, import, integrity verification, and dry-run restore.
- Add an automated backup job abstraction and a manual "Download backup"
  experience.
- Document how to recover after losing the original computer.
- Test a full round trip: create memory → export → clear a disposable test
  workspace → restore → verify canonical hashes, search results, and citations.
- Support readable Markdown export independently of the encrypted recovery
  package.
- Deletion must cover canonical versions, derived indexes, raw sources, jobs,
  connector credentials, and future backups according to the documented
  retention policy.

### 11. Observability and cost controls

- Structured logs with redaction; never log source bodies, tokens, keys, or
  decrypted memory.
- Sentry/OpenTelemetry-ready adapters, with local no-op implementations.
- Job dashboard data for status, attempts, duration, error category, model
  usage, and estimated cost.
- Per-workspace monthly AI budget and hard/soft limits.
- Idempotency and retry metrics.
- Health/readiness endpoints for web, worker, database, queue, storage, and MCP.

## Recommended repository shape

Use this as a direction, adjusting only when inspection finds a better
repository-native convention:

- apps/web — Next.js website and application API
- apps/worker — durable ingestion/indexing/background worker
- packages/domain — framework-independent entities, policies, and interfaces
- packages/db — Drizzle schema, SQL migrations, repositories, RLS tests
- packages/vault — versioned Markdown vault, export, restore, GitHub mirror
- packages/crypto — envelope encryption and key-provider interfaces
- packages/connectors — source adapters and fixtures
- packages/ingestion — normalization, chunking, extraction, reconciliation
- packages/search — embeddings, indexing, retrieval, citations
- packages/mcp — MCP server, tools/resources, authorization
- packages/ui — accessible design system and application components
- packages/config — typed environment/config validation

Use pnpm workspaces and TypeScript. Prefer a single repository and a modular
monolith over microservices. The web and worker may deploy separately but share
the same packages and domain.

## Database and tenancy requirements

- Use UUIDs or another non-guessable stable identifier.
- Every tenant-owned table includes workspace identity.
- Use PostgreSQL row-level security as defense in depth and test cross-tenant
  denial.
- Service credentials remain server-only.
- Use reviewed SQL migrations and reversible application migrations where
  practical.
- Include tables for users/workspaces/memberships/projects, connections,
  source items/revisions, sync runs/jobs, memory items/evidence/proposals/
  conflicts/versions, encrypted vault objects, chunks/embeddings/blind indexes,
  MCP clients/grants, audit events, deletion requests, backups, and model usage.
- Add unique constraints supporting idempotency and content-addressed storage.

## Testing requirements

Use Vitest for unit/integration tests and Playwright for browser flows. Add
contract/security tests for:

- tenant isolation and RLS;
- encryption round trips and tamper detection;
- key rotation;
- webhook signature verification and redelivery;
- idempotent ingestion/retry;
- evidence required before approval;
- conflict/supersession rules;
- canonical version immutability and hash verification;
- complete index rebuild from canonical Markdown;
- unauthorized/sensitive/proposed/deleted memory exclusion;
- citation resolution to the exact source version;
- MCP protocol results matching domain/web search;
- MCP scope and audience enforcement;
- backup/export/restore round trip;
- connector disconnect and workspace deletion;
- redaction of secrets and plaintext memory from logs;
- complete zero-jargon happy path and at least two recovery paths;
- responsive and keyboard-accessible UI.

Mock external providers at their HTTP boundary. Do not write tests that silently
call live paid services.

## Documentation and operations

Create:

- README with one-command local setup;
- architecture overview and data-flow diagram;
- threat model;
- privacy/data-flow matrix naming every processor and plaintext boundary;
- database schema guide;
- connector guide;
- MCP connection guide for Claude Code and Codex;
- backup/recovery guide;
- deployment guide for Supabase + Vercel + Railway + WorkOS, without actually
  deploying;
- environment-variable reference with safe placeholders only;
- cost-control guide;
- troubleshooting guide;
- explicit demo-mode limitations.

Never put real secrets or sensitive user data into documentation, fixtures,
logs, screenshots, or project memory.

## Execution protocol

Work through these phases internally without waiting between them:

1. inspect and write a short implementation map;
2. scaffold and establish quality commands;
3. domain model, database, vault, crypto, and tenancy;
4. ingestion, connectors, queue, and worker;
5. memory review/version/conflict workflows;
6. search, answers, and citations;
7. website and accessibility;
8. MCP and authorization;
9. backup/restore/deletion;
10. security hardening, tests, documentation, and visual QA.

Keep `docs/IMPLEMENTATION_STATUS.md` current with completed work, evidence,
remaining limitations, and the next resumable action. If your context is
compacted or the task spans multiple Claude Code sessions, continue from that
file and the unified project memory rather than restarting.

Do not reduce scope silently. If something cannot be completed, implement the
interface and fixture adapter, document the exact blocker, continue all
independent work, and report the limitation honestly at the end.

## Required quality commands

Establish and run:

- format check
- lint
- typecheck
- unit tests
- integration/security tests
- Playwright tests
- MCP contract tests
- production build

Run targeted checks throughout and the full suite at the end. Visually inspect
the main journey at mobile and desktop sizes. Fix failures caused by your work.

## Definition of done

The assignment is complete when:

- a fresh local checkout can be started from documented commands without cloud
  credentials in demo mode;
- the full paste/upload journey works through approved versioned Markdown,
  cited search/Ask, history, export, and local MCP;
- production adapters exist for Supabase, WorkOS, OpenAI/local models, Google
  Drive, GitHub, remote MCP OAuth, and worker deployment;
- absent credentials produce honest setup-required states, not broken pages or
  fake success;
- encrypted cloud persistence and a tested recovery/export/restore path are
  implemented;
- no computer-local copy is the sole copy of canonical memory;
- unauthorized, proposed, rejected, deleted, or overly sensitive memory cannot
  leak through web search, generated answers, logs, or MCP;
- the nontechnical path does not require GitHub or MCP vocabulary;
- all required checks pass;
- no external resource, repository, commit, push, or deployment was created
  without explicit approval;
- `memory/CURRENT_STATE.md` and `memory/NEXT_STEPS.md` contain the verified
  handoff;
- only explicitly approved durable decisions are added to
  `memory/DECISIONS.md`.

At the end, report:

1. what is fully working;
2. how to run and test it;
3. what remains fixture-backed until credentials are supplied;
4. security properties and remaining trust boundaries;
5. backup/recovery evidence;
6. all verification results;
7. the exact next external setup actions, ordered by value and risk.

Begin now. Do not merely produce another plan: implement, test, visually verify,
document, and leave the repository in a coherent resumable state.
```
