# Cairn

**One private memory, shared by the AI tools you choose.**

Cairn keeps the background you keep repeating — your projects, decisions, and
preferences — in one private place you control, and lets the AI tools you
authorize look up only the parts they need.

> `Cairn` is a **working name**, chosen so implementation could proceed. It is not
> an approved brand. Everything user-visible comes from
> `packages/config/src/product.ts`.

## Run it

```bash
pnpm install
pnpm setup      # generates a local encryption key and creates the database
pnpm demo:seed  # optional: fills it with an example project
pnpm dev        # http://localhost:3000
```

No account, API key, or cloud service is required. Sign in with any email
address; the code is printed by the server rather than emailed, and the interface
says so.

Requires Node 20.9+ and pnpm 9. The local database is a real PostgreSQL build
(PGlite) that runs in-process — no Docker, no server to install.

## What it does

1. You add something: paste a note, upload a document, or read a web page.
2. It finds the things worth remembering and shows you each one, with the exact
   sentence it came from.
3. You keep, reword, or throw away anything. Nothing is saved until you keep it.
4. You ask questions, and every answer shows its sources.
5. If you want, you connect an AI tool. It can look up only what you saved, and
   you can turn it off at any time.

Everything you keep is stored as ordinary Markdown you can download at any
moment, and the whole workspace can be deleted in one step.

## Checks

```bash
pnpm verify
```

Runs format, lint, typecheck, unit tests, integration tests, security tests, MCP
contract tests, and a production build. Browser tests run separately:

```bash
pnpm test:e2e:install   # once
pnpm test:e2e
```

| Command                 | What it proves                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm test`             | Encryption, canonical Markdown, policy, extraction, archive formats                        |
| `pnpm test:integration` | Paste → review → approve → cited answer; conflicts; index rebuild; backup and restore      |
| `pnpm test:security`    | Tenant isolation and RLS, disclosure rules, immutability, key rotation, redaction, budgets |
| `pnpm test:mcp`         | The MCP surface as a real client sees it                                                   |
| `pnpm test:e2e`         | The journey in a browser, desktop and mobile, including accessibility                      |

## Layout

```
apps/web             the website and its application API
apps/worker          the background worker (needs a PostgreSQL database)
packages/domain      entities, policies, and every external interface
packages/db          schema, reviewed SQL migrations, repositories, tenancy
packages/crypto      envelope encryption and key providers
packages/vault       versioned Markdown, export, backup, restore
packages/search      embeddings, retrieval, citations, answers
packages/ingestion   normalize, chunk, extract, reconcile, jobs
packages/connectors  paste, upload, URL, Google Drive, GitHub
packages/mcp         the MCP server and its authorization
packages/ui          the accessible component set
packages/config      typed configuration and product identity
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — how the pieces fit and where data flows
- [Threat model](docs/THREAT_MODEL.md) — what this protects against, and what it does not
- [Privacy and data flow](docs/PRIVACY_MATRIX.md) — every processor, every plaintext boundary
- [Database](docs/DATABASE.md) — schema, tenancy, and migrations
- [Connectors](docs/CONNECTORS.md) — sources and what each one reads
- [Connecting an AI tool](docs/MCP_GUIDE.md) — Claude Code, Codex, and the remote endpoint
- [Backup and recovery](docs/BACKUP_AND_RECOVERY.md) — losing your computer, and getting back
- [Deployment](docs/DEPLOYMENT.md) — Supabase, Vercel, Railway, WorkOS
- [Environment variables](docs/ENVIRONMENT.md) — every setting, with safe placeholders
- [Cost controls](docs/COST_CONTROLS.md) — what costs money and how it is capped
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Demo mode](docs/DEMO_MODE.md) — exactly what is real and what is not without credentials
- [Implementation status](docs/IMPLEMENTATION_STATUS.md) — what is done, what is not

## Honest limits

- This is **not** end-to-end encrypted. While the application is working on your
  memory it can read it; that is what lets it search and answer.
- No SOC 2, GDPR compliance, or zero-retention claim is made or implied.
- Google Drive and GitHub are implemented but need credentials; without them they
  report "setup required" and use sample documents.
- The remote MCP endpoint's OAuth path is implemented but has not been exercised
  against a live issuer.

## Project memory

This repository also carries the unified project memory the product was built
from, under `memory/`. `AGENTS.md` and `CLAUDE.md` tell Codex and Claude Code how
to read and update it.
