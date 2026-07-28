# Demo mode

What is real and what is not when you run this with no credentials. The rule
throughout is that an unconfigured provider says so rather than pretending.

Demo mode is the default. Nothing about it is a mock of the product: the same
schema, the same encryption, the same queue, the same canonical Markdown, the
same MCP server.

## Fully real

| Capability                | Notes                                                             |
| ------------------------- | ----------------------------------------------------------------- |
| The database              | Real PostgreSQL (PGlite), real row-level security, real pgvector  |
| Encryption                | Real AES-256-GCM, real per-workspace keys, real envelope wrapping |
| Paste, upload, URL import | Fully functional, including PDF and Word extraction               |
| The ingestion pipeline    | Real durable queue, real jobs, real retries and idempotency       |
| Review, edit, conflicts   | Complete                                                          |
| Canonical Markdown        | Real content-addressed, append-only versions                      |
| Search and citations      | Real vector search and real blind-index matching                  |
| Ask                       | Real answers, every statement tied to evidence                    |
| Export, backup, restore   | Real, and verified by fingerprint                                 |
| MCP                       | The real server and the real authorization path                   |
| Deletion                  | Real, and it really removes things                                |

## Substituted, and labelled

| Thing           | What happens instead                                      | Where you see it                                                                          |
| --------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Sign-in email   | The code is printed to the server log and shown on screen | A warning: "This computer is running in demo mode"                                        |
| Extraction      | A deterministic rule-based extractor                      | Settings: "Deterministic built-in extractor and embeddings. No text leaves this machine." |
| Embeddings      | Deterministic hashed embeddings                           | Same                                                                                      |
| Answering       | Extractive; it assembles the answer from your own memory  | The answer names the model it used                                                        |
| Google Drive    | Sample documents                                          | Badge: "Setup required", button: "Add in demo form"                                       |
| GitHub          | Sample documents                                          | Same                                                                                      |
| Object storage  | Encrypted rows in the local database                      | Settings, under "Where your data goes"                                                    |
| Error reporting | Structured logs only                                      | Settings                                                                                  |

## What the substitutions actually cost you

**Extraction** is cue-based: it recognises how people write decisions, next
steps, rules, and preferences, and it does that well on ordinary notes. It will
not infer anything unstated, and it will miss things phrased unusually.

**Embeddings** hash terms and character trigrams into the vector space. Search
behaves like smoothed keyword matching: it handles typos and word forms, and it
will not match "car" to "automobile". Both are deterministic, which is why the
tests can assert exact results.

**Answers** are assembled from your memory rather than written. They read a
little flatly and cannot be wrong about what you saved.

Switch any of these on with `AI_PROVIDER=openai` or `AI_PROVIDER=local` — the
domain does not change, only the adapter.

## The one structural difference

The local database runs **in-process**, so the website and a separate worker
cannot both open it. In demo mode the website drains the queue itself, through
the same handlers and the same claim path — jobs are real, they just run in the
same process. `pnpm dev:all` says so and does not start a worker.

Set `DATABASE_URL` and the worker runs separately, exactly as it does in
production.

## Is demo mode safe to keep real notes in?

The encryption is real and the key is real. Two caveats:

1. The key lives in `.env.local` on the same machine as the database, so it
   protects against a stolen database file, not a stolen laptop.
2. A local database file is a single copy. Take a backup —
   [see the recovery guide](BACKUP_AND_RECOVERY.md).

## Going further

- `pnpm demo:seed` fills a workspace with an example project, including one
  deliberate contradiction so the conflict screen has something real to show.
- `pnpm db:reset` destroys the local database and recreates it. It refuses to
  run when `DATABASE_URL` is set.
