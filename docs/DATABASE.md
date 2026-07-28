# Database

PostgreSQL with `pgvector`. Locally that is PGlite — a real PostgreSQL build
running in-process, so development and tests exercise the same SQL, including
row-level security and vector search, with nothing to install.

## Migrations

Hand-written and reviewed, in `packages/db/migrations`, applied in filename
order and recorded in `schema_migrations` with a checksum. Editing an applied
migration is refused: migrations are append-only, so add a new file.

| File                      | What it does                                                              |
| ------------------------- | ------------------------------------------------------------------------- |
| `0001_init.sql`           | Every table, the `cairn_app` role, and all RLS policies                   |
| `0002_vector_indexes.sql` | HNSW indexes; isolated because availability depends on the pgvector build |
| `0003_immutability.sql`   | Triggers blocking UPDATE on history, evidence, and audit                  |

```bash
pnpm db:migrate   # apply
pnpm db:reset     # local only; refuses to run when DATABASE_URL is set
```

`packages/db/src/schema.ts` mirrors the SQL for typed queries. The SQL stays the
source of truth because it carries the policies and grants Drizzle does not
model.

## Tenancy

Two access paths, and every call site chooses deliberately:

```ts
withTenant(handle, actor, tx => ...)  // SET LOCAL ROLE cairn_app + workspace id
withSystem(handle, tx => ...)         // owner role, RLS bypassed
```

`cairn_app` does not own the tables, so its policies apply. `withSystem` exists
for sign-in (before a workspace is known), the worker's cross-tenant claim loop,
migrations, and workspace deletion — and nowhere else.

`SET LOCAL` scopes both settings to the transaction, so a pooled connection
cannot carry one request's tenant into the next. A test asserts the setting is
empty after the transaction ends.

## Identity is workspace-scoped

`memory_items`, `source_items`, and `source_revisions` use a composite primary
key of `(workspace_id, id)` rather than a global one. Restoring a backup into a
second account on the same deployment must be able to keep the original
identifiers — they are embedded in the canonical Markdown, so changing them would
change the bytes and invalidate the fingerprint the restore is checked against.

## Tables

**Identity** — `users`, `workspaces`, `memberships`, `projects`,
`auth_challenges`, `sessions`

**Keys** — `workspace_keys` holds only the wrapped data key.

**Sources** — `source_connections` (credential encrypted), `source_items`
(unique on workspace + provider + external id), `source_revisions` (unique on
workspace + item + content hash — this constraint is what makes re-delivery a
no-op), `stored_objects`

**Derived** — `chunks`, `chunk_embeddings`, `memory_item_embeddings`,
`memory_blind_terms`. All disposable and rebuildable.

**Memory** — `memory_items` (title and value encrypted; `normalized_hash` is a
keyed hash for duplicate detection), `memory_evidence`, `memory_conflicts`,
`memory_proposals`

**Vault** — `vault_objects` (content-addressed, encrypted, keyed on
workspace + hash so identical content is stored once), `vault_versions`
(append-only, with a manifest and its hash)

**Operations** — `jobs` (unique on workspace + idempotency key), `sync_runs`,
`webhook_deliveries`, `mcp_clients`, `audit_events`, `deletion_requests`,
`backups`, `model_usage`, `workspace_settings`, `rate_limits`

## The constraints that carry the weight

| Constraint                                                                       | What it guarantees                                                            |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `jobs (workspace_id, idempotency_key)`                                           | Enqueueing the same work twice is a no-op                                     |
| `source_revisions (workspace_id, source_item_id, content_hash)`                  | Re-importing identical bytes changes nothing                                  |
| `source_items (workspace_id, provider, external_id)`                             | One row per provider object                                                   |
| `webhook_deliveries (provider, delivery_id)`                                     | A redelivered webhook is recognised                                           |
| `vault_objects (workspace_id, content_hash)`                                     | Identical documents stored once                                               |
| Triggers on `vault_versions`, `vault_objects`, `memory_evidence`, `audit_events` | History cannot be rewritten; DELETE is still allowed so deletion stays honest |

## Encryption at the column level

Encrypted (`bytea`): memory titles and values, evidence excerpts, chunk text,
normalized source text, vault objects, stored objects, connector credentials.

Plaintext: identifiers, timestamps, types, statuses, sensitivity, visibility,
topics, content hashes, source titles and URLs, and embeddings. See
[the privacy matrix](PRIVACY_MATRIX.md) for why, and the
[threat model](THREAT_MODEL.md) for what that discloses.
