# Unified-memory product research

**Research date:** 2026-07-27  
**Scope:** Public first-party material from the user's GitHub template,
Unabyss, GitHub, MCP, PostgreSQL/pgvector, Supabase, and W3C. Public product
claims are recorded as claims, not independently verified performance or
security guarantees.

## Executive finding

The proposed product is a private, shared memory for a person's projects and AI
tools. A user connects places where useful information already lives, the
service turns that material into a clean project memory, and the same relevant
facts become available in a simple website and in authorized AI tools. Every
answer should show where it came from. Under the hood, the project's durable
memory remains readable, version-controlled Markdown, but the user should never
need to understand Git, repositories, embeddings, or MCP.

This is not merely "Unabyss with another name." The clearest original
differentiators are:

1. **Version-controlled Markdown remains authoritative**, not just an export.
2. **Citation-first retrieval** links every fact and answer to an exact source
   and memory version.
3. **The website is the primary product**, with Git and MCP treated as invisible
   infrastructure or optional advanced connections.

## 1. What the existing template does

The public repository is a small, provider-neutral handoff convention rather
than an application. Its [README](https://github.com/johnmontejano/codex-claude-unified-memory-template/blob/main/README.md)
says Codex and Claude Code read and update the same tracked Markdown, so no
separate synchronization step is needed.

- [`AGENTS.md`](https://github.com/johnmontejano/codex-claude-unified-memory-template/blob/main/AGENTS.md)
  tells agents to read five memory files before substantial work, prefer them
  over chat/tool memory, and update them afterward.
- [`CLAUDE.md`](https://github.com/johnmontejano/codex-claude-unified-memory-template/blob/main/CLAUDE.md)
  imports `AGENTS.md`, giving Claude Code the same instructions.
- [`memory/README.md`](https://github.com/johnmontejano/codex-claude-unified-memory-template/blob/main/memory/README.md)
  defines the five roles: operating rules, project brief, current state,
  decisions, and next steps.
- The operating rules require evidence, safety, validation, and concise
  handoffs; the [decision log](https://github.com/johnmontejano/codex-claude-unified-memory-template/blob/main/memory/DECISIONS.md)
  records the durable design choice to use tracked Markdown.
- The project-specific brief and state in the current template are placeholders;
  there is no ingestion pipeline, schema, search index, web UI, remote sync, or
  MCP server.

**Strength to preserve:** the memory is transparent, editable without a
proprietary client, versionable, portable between agents, and reviewable as a
diff.

**Limit to remove:** initialization and upkeep require a local folder, GitHub
fluency, and disciplined agent behavior. Retrieval is file-level rather than
relevance-ranked, source provenance is informal, and multiple writers have no
explicit conflict workflow.

## 2. What Unabyss publicly presents

### Confirmed product positioning and flow

Unabyss calls itself a universal context layer: connect existing sources once,
automatically structure a profile/vault, then let authorized AI tools retrieve
the relevant context over MCP. It contrasts this with tool-specific memory
being siloed and hand-maintained context files becoming stale.
[Home](https://unabyss.com/) ·
[How it works](https://unabyss.com/how-it-works) ·
[Context-files comparison](https://unabyss.com/unabyss-vs-context-files)

Its idealized onboarding is:

1. Connect at least two source apps.
2. Wait while context is extracted and tagged.
3. Connect an AI client over MCP.

The public page advertises this as an under-90-second, "no writing, no forms"
flow, while host-specific instructions still require technical steps for some
clients. For example, its ChatGPT guide uses a custom connector and developer
mode. [How it works](https://unabyss.com/how-it-works) ·
[Connect Claude](https://unabyss.com/connect-claude) ·
[Connect ChatGPT](https://unabyss.com/connect-chatgpt)

### Confirmed feature surface

Unabyss's terms enumerate structured context files/documents, context chat,
third-party import and synchronization, semantic search, MCP distribution,
speech-to-text, Markdown dossier exports, and a browser extension.
[Terms, section 4](https://unabyss.com/terms)

Public pages and changelogs also describe:

- continuous or scheduled source refresh, live import progress/history, manual
  resync, reconnect states, and background recovery;
- context tagged by topic, source, and sensitivity rather than retained only as
  a transcript;
- context chat for asking, refining, and correcting memory;
- save-back choices for connected agents ("everything," "important only," or
  "nothing");
- per-app and per-file sharing controls;
- editable, versioned, downloadable Markdown exports;
- dashboards, weekly recaps, onboarding tours, guided connection dialogs, and
  preset question choices.

[How it works](https://unabyss.com/how-it-works) ·
[v0.3.0](https://unabyss.com/changelog/v0-3-0) ·
[v0.4.0](https://unabyss.com/changelog/v0-4-0) ·
[v0.5.0](https://unabyss.com/changelog/v0-5-0) ·
[v1.3.0](https://unabyss.com/changelog/v1-3-0) ·
[v1.5.0](https://unabyss.com/changelog/v1-5-0)

Its current integration catalog lists multiple MCP clients and more than twenty
source applications. That breadth is evidence of the destination, not a
sensible first-release scope for this project.
[Integrations](https://unabyss.com/integrations)

### Confirmed trust and permission claims

Unabyss says source connections are explicitly authorized, read-only, OAuth
based where supported, and revocable; disconnecting stops future imports but
does not silently delete previously imported context. It says data is encrypted
in transit and at rest, is not used for model training, and can be deleted by
the user. It labels SOC 2 Type II as **in progress**, not completed.
[Security](https://unabyss.com/security) ·
[Privacy](https://unabyss.com/privacy)

It also identifies the MCP boundary clearly: once context is delivered to an
external AI, that tool's terms and data handling apply.
[Security](https://unabyss.com/security)

### Not confirmed by public material

The following implementation details are not public and should not be invented:

- its canonical data schema or conflict-resolution algorithm;
- its database, vector index, embedding model, chunking, ranking, or deduping;
- exact freshness guarantees for every integration;
- how it prevents prompt injection in imported content;
- whether chat, search, and MCP answers provide clickable citations to exact
  source records or quoted spans.

The public product confirms source tags and semantic search, but those are weaker
than answer-level citations. Citation-first answers are therefore an original
opportunity, not a confirmed Unabyss behavior.

## 3. Product implications for a "grandma-simple" website

The core experience should work without GitHub and without connecting an AI
tool. Git and MCP belong behind an "Advanced" or "Connect an AI" path.

### Recommended first-run experience

1. **One welcoming question:** "What would you like your AI to remember?"
2. **One easy input:** paste text, upload files/folders, or connect one familiar
   app. Do not require two integrations before value appears.
3. **Visible progress in ordinary language:** "Reading 12 documents," "Found 8
   project decisions," "Ready."
4. **Immediate payoff:** a short "What I know about this project" page and an
   ask box that returns cited answers.
5. **Review before trust:** show proposed memories as plain-language cards with
   source, date, keep/edit/remove, and undo.
6. **Optional connection:** only after value is visible, offer "Use this memory
   in Claude," "Use this memory in Codex," and similar guided paths.

### Interface constraints

- Use everyday labels: "Memory," "Sources," "Ask," "Connected AIs," and
  "History." Do not make "repository," "commit," "vector," or "MCP" primary
  navigation terms.
- Keep one dominant action per screen, offer safe defaults, and defer schedules,
  scopes, models, and tokens to advanced settings.
- Show a simple trust sentence before every connection: what will be read, what
  will never be changed, and how to disconnect/delete it.
- Make destructive and sharing actions reviewable, reversible where possible,
  and clearly distinct from reading. W3C recommends review/correction or
  reversibility for submitted data, descriptive text errors, consistent help,
  and sufficiently large targets; 44×44 CSS pixels is the enhanced target-size
  benchmark.
  [WCAG 2.2](https://www.w3.org/TR/WCAG22/) ·
  [Error identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification) ·
  [Clear step-by-step instructions](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p07-step-instructions/)
- Pair every AI-generated statement with a visible "Why do you know this?"
  affordance that opens the exact excerpt, source, sync time, and memory
  revision.

## 4. Recommended architecture and constraints

### Design principle: canonical Markdown, derived indexes

Use a **Git-backed vault per workspace** as the canonical durable project
memory, managed internally so users do not need a GitHub account. Keep the
familiar memory documents and add stable IDs plus compact structured metadata
where needed. Every accepted manual edit, ingestion merge, or agent save-back
becomes a commit with an attributable author, reason, and source references.

PostgreSQL should be a **control plane and materialized read model**, not a
second competing source of truth for canonical project memory. It stores users,
workspaces, connector state, source metadata, jobs, permissions, audit events,
parsed memory items, search chunks, and embeddings. Every derived row should
include its canonical Git commit SHA, Markdown path, stable item ID, and content
hash. If the database and Markdown disagree, rebuild the derived rows from the
canonical commit.

Raw imported files and immutable provider payloads belong in encrypted object
storage, not the Git vault. The vault stores the distilled memory plus
provenance pointers; citations point to authorized raw excerpts or provider
URLs.

### Suggested modular-monolith stack

- **Language/repository:** TypeScript monorepo.
- **Web UI and application API:** Next.js, with server-rendered authenticated
  pages and accessible React components.
- **Database/auth/storage:** managed PostgreSQL, authentication, and object
  storage. Supabase is a pragmatic early option because its official platform
  exposes Postgres, row-level security, `pgvector`, object storage, and a
  Postgres-native durable queue.
  [Database overview](https://supabase.com/docs/guides/database/overview) ·
  [Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security) ·
  [Queues](https://supabase.com/docs/guides/queues)
- **Search:** PostgreSQL full-text search plus `pgvector` hybrid ranking. Native
  `tsvector`/`tsquery` support lexical search; pgvector supports exact search,
  HNSW/IVFFlat indexes, and explicitly documents hybrid use with Postgres
  full-text search.
  [PostgreSQL text search](https://www.postgresql.org/docs/current/datatype-textsearch.html) ·
  [pgvector](https://github.com/pgvector/pgvector)
- **Background work:** a durable queue and separately deployed workers for
  imports, normalization, extraction, embedding, reconciliation, and reindexing.
  Never perform full ingestion inside an OAuth callback, webhook request, or
  page request.
- **MCP:** the official TypeScript SDK, exposed as a remote Streamable HTTP
  endpoint. The official SDK recommends Streamable HTTP for remote servers and
  stdio for local integrations.
  [MCP TypeScript server guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)
- **Git integration:** a server-side Git library/service owns canonical vault
  commits. GitHub is an optional adapter for users who want their memory mirrored
  to a repository, not a required identity or storage provider.

Keep this a modular monolith for the first release: one web application, one
worker deployment, one PostgreSQL database, one object store, and one MCP
endpoint. Service boundaries can be extracted after measured load or security
needs justify them.

### Ingestion and synchronization flow

```text
User/API connection
  -> webhook or scheduled poll
  -> verify, deduplicate, enqueue
  -> immutable raw source item
  -> normalize and chunk
  -> extract candidate memories + provenance
  -> dedupe / flag conflicts
  -> policy or user approval
  -> commit canonical Markdown
  -> parse commit into Postgres read model
  -> lexical + vector indexes
  -> website / MCP retrieval with citations
```

Connector jobs must be idempotent and replayable. GitHub recommends verifying
webhook signatures, returning a 2xx response within ten seconds, processing
asynchronously, and using `X-GitHub-Delivery` to recognize redeliveries.
[Webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) ·
[Webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)

For GitHub, prefer a GitHub App over personal access tokens: apps have narrow
permissions, repository-specific installation access, built-in webhooks, and
short-lived installation authentication. Start read-only and request only the
minimum events and repository permissions.
[About GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps) ·
[App authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app) ·
[Choosing permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)

### Structured memory and citations

Each canonical memory item should have at least:

- stable ID and type (`brief`, `fact`, `decision`, `state`, `next_step`,
  `rule`);
- workspace/project and topic tags;
- value/status plus `observed_at`, optional `valid_from`/`valid_to`, and
  supersession links;
- sensitivity and visibility policy;
- one or more provenance records: provider, source item ID, source version,
  URI/locator, excerpt offsets, content hash, imported time, and extraction
  method;
- canonical Markdown path and commit SHA.

Do not silently overwrite contradictions. Preserve both source assertions,
mark the conflict, and ask the user or an authorized agent to resolve it. Manual
user corrections and explicit approved decisions should outrank passive
extraction, while the losing assertion remains in history.

Search should apply authorization and sensitivity filters **before** returning
content, combine lexical and semantic candidates, rerank, and return structured
citation objects alongside text. A citation is valid only when it can be traced
to the exact source version and canonical memory revision used.

### MCP surface and security

MCP standardizes both **resources** (application-selected contextual data) and
**tools** (model-invoked operations). Resources have URIs and optional
subscriptions/list-change notifications; tools support discovery and structured
results.
[MCP resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources) ·
[MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

Recommended initial surface:

- resources for the five canonical memory documents and their current revision;
- `search_memory` returning ranked passages and structured citations;
- `get_memory_item` and `list_recent_changes`;
- `propose_memory_update` returning a human-readable diff;
- no silent write tool in the first release. Approval in the website creates
  the commit. Later, add scoped write access with an explicit save-back policy.

Remote MCP handles private user data, so implement OAuth-compatible
authorization, validate token audience, use least-privilege scopes
(`memory:read`, `memory:propose`, later `memory:write`), keep read and write
separate, and audit every query and proposal. The current MCP specification
defines authorization for HTTP transports; Streamable HTTP servers must
validate origins and should authenticate connections.
[Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) ·
[Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

Do not pass upstream provider tokens through MCP or expose them to models.
Official MCP security guidance forbids token passthrough, recommends
per-client consent and scope minimization, and treats session identifiers as
non-authentication state.
[MCP security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)

Imported documents and webpages are untrusted data, never instructions. Keep
their content isolated from system prompts, restrict retrieval by tenant and
policy, and require approval for writes and all consequential actions.

## 5. Confirmed facts versus recommendations

| Statement                                                                                                                                         | Status                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| The template makes tracked Markdown the shared memory for Codex and Claude Code.                                                                  | Confirmed                                          |
| The current template has no application, ingestion, search, sync service, or MCP server.                                                          | Confirmed                                          |
| Unabyss publicly offers/claims source ingestion and sync, structured context, semantic search, chat, exports, granular sharing, and MCP delivery. | Confirmed public claim                             |
| Unabyss publicly documents exact answer-level citations.                                                                                          | Not confirmed                                      |
| Unabyss uses a particular database, vector store, schema, or ranking algorithm.                                                                   | Not confirmed                                      |
| Git-backed canonical Markdown plus a derived Postgres index is the right design for this product.                                                 | Recommendation                                     |
| The nontechnical experience should deliver value before GitHub or MCP setup.                                                                      | Recommendation based on the user's stated audience |
| The first release should be a modular monolith with a narrow connector set and read-first MCP.                                                    | Recommendation                                     |

## 6. Scope implication for the first build

The first implementation prompt should ask Claude Code to produce a product
foundation and one end-to-end tracer path, not a broad Unabyss clone:

1. initialize the product brief and architecture records without discarding the
   current memory convention;
2. create the accessible website shell and zero-jargon onboarding;
3. prove one path from user-provided content to an approved canonical Markdown
   commit, searchable with exact citations, then exposed through read-only MCP.

A zero-setup input such as paste/upload should be included even if GitHub is the
first automatic connector. The first mainstream OAuth connector should be
chosen after user interviews (for example, Google Drive or Notion); GitHub
must remain optional so the architecture does not recreate the template's
original barrier.

## Sources

- User template: [repository](https://github.com/johnmontejano/codex-claude-unified-memory-template),
  [README](https://github.com/johnmontejano/codex-claude-unified-memory-template/blob/main/README.md),
  [AGENTS.md](https://github.com/johnmontejano/codex-claude-unified-memory-template/blob/main/AGENTS.md),
  [CLAUDE.md](https://github.com/johnmontejano/codex-claude-unified-memory-template/blob/main/CLAUDE.md),
  [memory guide](https://github.com/johnmontejano/codex-claude-unified-memory-template/blob/main/memory/README.md)
- Unabyss: [home](https://unabyss.com/),
  [how it works](https://unabyss.com/how-it-works),
  [integrations](https://unabyss.com/integrations),
  [FAQ](https://unabyss.com/faq),
  [terms](https://unabyss.com/terms),
  [privacy](https://unabyss.com/privacy),
  [security](https://unabyss.com/security),
  [MCP API reference](https://unabyss.com/mcp-docs)
- MCP: [specification](https://modelcontextprotocol.io/specification/2025-11-25),
  [resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources),
  [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools),
  [authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization),
  [transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
  [security guidance](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices),
  [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- GitHub: [GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps),
  [app authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app),
  [app permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app),
  [webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries),
  [webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
- Data/search: [PostgreSQL text search](https://www.postgresql.org/docs/current/datatype-textsearch.html),
  [pgvector](https://github.com/pgvector/pgvector),
  [Supabase database](https://supabase.com/docs/guides/database/overview),
  [Supabase queues](https://supabase.com/docs/guides/queues)
- Accessibility: [WCAG 2.2](https://www.w3.org/TR/WCAG22/),
  [W3C cognitive accessibility](https://www.w3.org/WAI/people-use-web/abilities-barriers/cognitive/)
