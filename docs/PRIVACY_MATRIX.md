# Privacy and data flow

Every processor that can touch your data, and exactly where plaintext exists.
This is the document to check before telling anyone what the product promises.

## Demo mode (a fresh checkout, no credentials)

| Operation                | Handled by                      | Sees plaintext?               | Leaves the machine?                 |
| ------------------------ | ------------------------------- | ----------------------------- | ----------------------------------- |
| Sign-in                  | This application                | Email address only            | No — the code is printed to the log |
| Storing memory           | Local PostgreSQL file           | No — encrypted before writing | No                                  |
| Storing documents        | Local PostgreSQL file           | No — encrypted before writing | No                                  |
| Finding what to remember | Built-in rule-based extractor   | Yes, in-process               | No                                  |
| Search and embeddings    | Built-in deterministic embedder | Yes, in-process               | No                                  |
| Answering                | Built-in extractive answerer    | Yes, in-process               | No                                  |
| Connected AI tools       | Whatever you connect            | Only what it looks up         | Yes, to that tool                   |

In demo mode nothing leaves the machine unless you connect an AI tool.

## Hosted mode (the documented deployment)

| Operation          | Processor             | What it receives                   | Plaintext there?                       |
| ------------------ | --------------------- | ---------------------------------- | -------------------------------------- |
| Sign-in            | WorkOS AuthKit        | Email address, name                | Yes — identity only                    |
| Application code   | Vercel                | Everything in a request            | Yes — this is the trusted core         |
| Worker             | Railway               | Everything it processes            | Yes — same trust as above              |
| Database           | Supabase PostgreSQL   | Ciphertext + metadata              | **No**, except metadata and embeddings |
| Object storage     | Supabase Storage      | Encrypted snapshots                | No                                     |
| Extraction         | OpenAI Responses API  | Document text, with `store: false` | **Yes**                                |
| Embeddings         | OpenAI embeddings     | Memory text                        | **Yes**                                |
| Answering          | OpenAI Responses API  | Retrieved excerpts + question      | **Yes**                                |
| Error reports      | Sentry (optional)     | Exception type and message only    | No content                             |
| Connected AI tools | Claude, Codex, others | Retrieved memory and citations     | **Yes**                                |

## What is stored in plaintext, deliberately

Encrypting these would break features that depend on them. They are listed so the
trade is visible rather than implied.

| Data                       | Why                           | What it discloses                                |
| -------------------------- | ----------------------------- | ------------------------------------------------ |
| Topic tags                 | Filtering and the topic chips | Subject matter                                   |
| Type and status            | Filtering, canonical routing  | Structure of the workspace                       |
| Sensitivity and visibility | Applied _before_ decryption   | Which items are marked sensitive                 |
| Timestamps                 | Ordering, history, retention  | Activity pattern                                 |
| Content hashes             | Deduplication, integrity      | Confirms a guessed document; does not reveal one |
| Source titles and URLs     | Citations must be readable    | Names of documents                               |
| **Embeddings**             | pgvector must compare them    | Partially invertible — see the threat model      |
| Blind-index term hashes    | Exact keyword search          | Term frequency, not terms                        |

## Where each secret lives

| Secret                | Stored                       | Never                                         |
| --------------------- | ---------------------------- | --------------------------------------------- |
| Deployment master key | Environment variable or KMS  | In the database, repository, logs, or browser |
| Workspace data key    | Wrapped, in `workspace_keys` | Unwrapped at rest                             |
| Derived subkeys       | Nowhere — derived per use    | Stored                                        |
| Session token         | Hashed                       | Stored raw                                    |
| AI connection code    | Hashed, shown once           | Stored raw                                    |
| Connector credentials | Encrypted, per connection    | Sent to a model or through MCP                |
| Backup passphrase     | Nowhere                      | Stored, logged, or recoverable                |

No configuration value is prefixed `NEXT_PUBLIC_`, so nothing here can reach a
browser bundle.

## Turning the external boundary off

Privacy mode is a workspace setting. With `AI_PROVIDER=fixture` — the default —
no document text is sent to any external model at all. Setting
`AI_PROVIDER=local` with `LOCAL_AI_BASE_URL` keeps extraction and embeddings on
your own infrastructure while keeping the hosted database.

## What deleting actually removes

Deleting a workspace removes memory, evidence, sources, revisions, chunks,
versions, stored documents, stored files, connections, connected AIs, audit
history, usage records, backup records, and finally the workspace key itself.
The deletion report names each category and its row count.

What it cannot reach, and says so:

- Files you exported or downloaded yourself.
- Anything an AI tool already stored in its own history.
- Your hosted database provider's own backups, for their retention window.

Disconnecting a source is narrower and the interface says so: it stops future
reading and destroys the stored credential immediately, and leaves memory already
saved untouched.
