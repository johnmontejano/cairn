-- Cairn initial schema.
--
-- Reviewed by hand rather than generated, because three things here are easy to
-- get subtly wrong and expensive to fix later:
--   1. every tenant-owned row carries workspace_id and is covered by row-level
--      security, so a forgotten WHERE clause cannot leak across tenants;
--   2. anything derived from user content is stored encrypted (bytea envelopes)
--      or as a keyed hash, never as a plaintext corpus;
--   3. unique constraints, not application logic, are what make ingestion
--      idempotent under duplicate delivery.
--
-- Access model:
--   * The migration/system path connects as the database owner and bypasses RLS.
--     It is used for sign-in (before a workspace is known), the worker's job
--     claim loop, and migrations.
--   * Every request-scoped query runs as role `cairn_app` with
--     `cairn.workspace_id` set. `cairn_app` does not own these tables, so RLS is
--     enforced against it.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------- roles ----

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cairn_app') THEN
    CREATE ROLE cairn_app NOLOGIN;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION cairn_current_workspace() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('cairn.workspace_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION cairn_current_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('cairn.user_id', true), '')::uuid
$$;

-- ------------------------------------------------------------- identity ----

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL,
  email_lower   text GENERATED ALWAYS AS (lower(email)) STORED,
  display_name  text,
  external_id   text,
  auth_provider text NOT NULL DEFAULT 'fixture',
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (email_lower);

CREATE TABLE IF NOT EXISTS workspaces (
  id             uuid PRIMARY KEY,
  name           text NOT NULL,
  owner_user_id  uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE TABLE IF NOT EXISTS memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  slug         text NOT NULL,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (workspace_id, slug)
);

-- Sign-in challenges. The code itself is never stored, only a hash of it.
CREATE TABLE IF NOT EXISTS auth_challenges (
  id          uuid PRIMARY KEY,
  email       text NOT NULL,
  code_hash   text NOT NULL,
  purpose     text NOT NULL DEFAULT 'email_code',
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id            uuid PRIMARY KEY,
  token_hash    text NOT NULL UNIQUE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id  uuid REFERENCES workspaces (id) ON DELETE CASCADE,
  csrf_secret   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  user_agent    text,
  ip            text
);

-- ------------------------------------------------------------------ keys ----

-- Only the *wrapped* data key lives here. The key that unwraps it is held by an
-- environment variable (local) or a KMS (production) and never by the database.
CREATE TABLE IF NOT EXISTS workspace_keys (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  wrapped_dek  bytea NOT NULL,
  key_provider text NOT NULL,
  kek_version  text NOT NULL,
  state        text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'retired')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  rotated_at   timestamptz
);

-- --------------------------------------------------------------- sources ----

CREATE TABLE IF NOT EXISTS source_connections (
  id                     uuid PRIMARY KEY,
  workspace_id           uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id             uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  provider               text NOT NULL,
  display_name           text NOT NULL,
  state                  text NOT NULL DEFAULT 'active',
  scopes                 text[] NOT NULL DEFAULT '{}',
  cursor                 text,
  external_account_label text,
  encrypted_credential   bytea,
  last_synced_at         timestamptz,
  last_error             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  disconnected_at        timestamptz
);
CREATE INDEX IF NOT EXISTS source_connections_ws_idx ON source_connections (workspace_id, project_id);

CREATE TABLE IF NOT EXISTS source_items (
  -- Identity is scoped to the workspace, not global. Restoring a backup into a
  -- second account on the same deployment must be able to keep the original
  -- identifiers: they are embedded in the canonical Markdown, so changing them
  -- would change the bytes and invalidate the fingerprint the restore is checked
  -- against.
  id                  uuid NOT NULL,
  workspace_id        uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id          uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  connection_id       uuid REFERENCES source_connections (id) ON DELETE SET NULL,
  provider            text NOT NULL,
  external_id         text NOT NULL,
  title               text NOT NULL,
  mime_type           text NOT NULL,
  canonical_uri       text,
  current_revision_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  PRIMARY KEY (workspace_id, id),
  -- Re-importing the same provider object updates one row instead of duplicating.
  UNIQUE (workspace_id, provider, external_id)
);

CREATE TABLE IF NOT EXISTS source_revisions (
  id                   uuid NOT NULL,
  workspace_id         uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  source_item_id       uuid NOT NULL,
  external_revision    text,
  content_hash         text NOT NULL,
  byte_size            integer NOT NULL,
  normalized_chars     integer NOT NULL DEFAULT 0,
  storage_key          text,
  encrypted_normalized bytea,
  imported_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, source_item_id) REFERENCES source_items (workspace_id, id) ON DELETE CASCADE,
  -- Identical bytes for the same item are the same revision: content-addressed
  -- storage plus this constraint is what makes re-delivery a no-op.
  UNIQUE (workspace_id, source_item_id, content_hash)
);

-- Encrypted blobs when no external object store is configured.
CREATE TABLE IF NOT EXISTS stored_objects (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  key          text NOT NULL,
  bytes        bytea NOT NULL,
  byte_size    integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, key)
);

-- ---------------------------------------------------------------- chunks ----

CREATE TABLE IF NOT EXISTS chunks (
  id                 uuid PRIMARY KEY,
  workspace_id       uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id         uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  source_revision_id uuid NOT NULL,
  ordinal            integer NOT NULL,
  start_offset       integer NOT NULL,
  end_offset         integer NOT NULL,
  char_count         integer NOT NULL,
  encrypted_text     bytea NOT NULL,
  content_hash       text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, source_revision_id) REFERENCES source_revisions (workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, source_revision_id, ordinal)
);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id     uuid PRIMARY KEY REFERENCES chunks (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  embedding    vector(1536) NOT NULL,
  model        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------ memory ----

CREATE TABLE IF NOT EXISTS memory_items (
  id                        uuid NOT NULL,
  workspace_id              uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id                uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  type                      text NOT NULL,
  status                    text NOT NULL CHECK (status IN ('proposed','approved','rejected','superseded','conflicted')),
  encrypted_title           bytea NOT NULL,
  encrypted_value           bytea NOT NULL,
  -- Keyed hash of the normalized value. Enables duplicate detection without a
  -- plaintext copy existing anywhere in the database.
  normalized_hash           bytea NOT NULL,
  topics                    text[] NOT NULL DEFAULT '{}',
  sensitivity               text NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal','sensitive','restricted')),
  visibility                text NOT NULL DEFAULT 'share_with_authorized_clients'
                              CHECK (visibility IN ('share_with_authorized_clients','website_only','never_share')),
  observed_at               timestamptz,
  imported_at               timestamptz NOT NULL DEFAULT now(),
  valid_from                timestamptz,
  valid_to                  timestamptz,
  supersedes_id             uuid,
  superseded_by_id          uuid,
  conflict_group_id         uuid,
  extraction_method         text NOT NULL CHECK (extraction_method IN ('user_manual','user_edit','ai_extraction','import')),
  extraction_model          text,
  extraction_prompt_version text,
  extraction_schema_version text,
  confidence                real,
  canonical_path            text,
  canonical_version_id      uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz,
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS memory_items_ws_project_idx ON memory_items (workspace_id, project_id, status);
CREATE INDEX IF NOT EXISTS memory_items_norm_idx ON memory_items (workspace_id, project_id, normalized_hash);
CREATE INDEX IF NOT EXISTS memory_items_conflict_idx ON memory_items (workspace_id, conflict_group_id);

CREATE TABLE IF NOT EXISTS memory_item_embeddings (
  memory_item_id uuid NOT NULL,
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  embedding      vector(1536) NOT NULL,
  model          text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, memory_item_id),
  FOREIGN KEY (workspace_id, memory_item_id) REFERENCES memory_items (workspace_id, id) ON DELETE CASCADE
);

-- Blind index: HMAC(term) under a workspace-derived key. Supports exact keyword
-- matching without storing a searchable plaintext corpus. Leaks per-workspace
-- term frequency; documented in docs/THREAT_MODEL.md.
CREATE TABLE IF NOT EXISTS memory_blind_terms (
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  memory_item_id uuid NOT NULL,
  term_hash      bytea NOT NULL,
  PRIMARY KEY (workspace_id, memory_item_id, term_hash),
  FOREIGN KEY (workspace_id, memory_item_id) REFERENCES memory_items (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS memory_blind_terms_lookup_idx ON memory_blind_terms (workspace_id, term_hash);

CREATE TABLE IF NOT EXISTS memory_evidence (
  id                 uuid PRIMARY KEY,
  workspace_id       uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  memory_item_id     uuid NOT NULL,
  source_item_id     uuid NOT NULL,
  source_revision_id uuid NOT NULL,
  start_offset       integer NOT NULL,
  end_offset         integer NOT NULL,
  encrypted_excerpt  bytea NOT NULL,
  locator            text,
  content_hash       text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, memory_item_id) REFERENCES memory_items (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, source_item_id) REFERENCES source_items (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, source_revision_id) REFERENCES source_revisions (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS memory_evidence_item_idx ON memory_evidence (workspace_id, memory_item_id);

CREATE TABLE IF NOT EXISTS memory_conflicts (
  id                       uuid PRIMARY KEY,
  workspace_id             uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id               uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  memory_item_ids          uuid[] NOT NULL,
  reason                   text NOT NULL,
  status                   text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_memory_item_id  uuid,
  resolved_by              uuid,
  resolved_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_proposals (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  memory_item_id uuid NOT NULL,
  origin         text NOT NULL CHECK (origin IN ('ingestion','mcp_client','user')),
  client_id      uuid,
  note           text,
  state          text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','rejected')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  decided_by     uuid,
  FOREIGN KEY (workspace_id, memory_item_id) REFERENCES memory_items (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS memory_proposals_pending_idx ON memory_proposals (workspace_id, project_id, state);

-- ----------------------------------------------------------------- vault ----

-- Content-addressed encrypted blobs. Two versions sharing a file share the row.
CREATE TABLE IF NOT EXISTS vault_objects (
  workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  content_hash      text NOT NULL,
  encrypted_content bytea NOT NULL,
  byte_size         integer NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, content_hash)
);

-- Append-only. Nothing updates a row here; correcting memory adds a new version.
CREATE TABLE IF NOT EXISTS vault_versions (
  id                uuid PRIMARY KEY,
  workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  parent_version_id uuid REFERENCES vault_versions (id) ON DELETE RESTRICT,
  author_user_id    uuid,
  author_label      text NOT NULL,
  reason            text NOT NULL,
  manifest_hash     text NOT NULL,
  manifest          jsonb NOT NULL,
  provenance        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vault_versions_project_idx ON vault_versions (workspace_id, project_id, created_at DESC);

-- ------------------------------------------------------------------ jobs ----

CREATE TABLE IF NOT EXISTS jobs (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects (id) ON DELETE CASCADE,
  type            text NOT NULL,
  state           text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','succeeded','failed','dead')),
  idempotency_key text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 5,
  run_at          timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  duration_ms     integer,
  error_category  text,
  last_error      text,
  locked_by       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- The whole retry/replay story rests on this one constraint.
  UNIQUE (workspace_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (state, run_at);

CREATE TABLE IF NOT EXISTS sync_runs (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  connection_id  uuid NOT NULL REFERENCES source_connections (id) ON DELETE CASCADE,
  state          text NOT NULL DEFAULT 'running' CHECK (state IN ('running','succeeded','failed','partial')),
  items_seen     integer NOT NULL DEFAULT 0,
  items_imported integer NOT NULL DEFAULT 0,
  items_skipped  integer NOT NULL DEFAULT 0,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  message        text
);

-- Webhook redelivery guard: providers retry, and they are entitled to.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  provider     text NOT NULL,
  delivery_id  text NOT NULL,
  workspace_id uuid,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, delivery_id)
);

-- ------------------------------------------------------------------- mcp ----

CREATE TABLE IF NOT EXISTS mcp_clients (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name           text NOT NULL,
  scopes         text[] NOT NULL DEFAULT '{memory:read}',
  project_ids    uuid[],
  max_sensitivity text NOT NULL DEFAULT 'normal' CHECK (max_sensitivity IN ('normal','sensitive','restricted')),
  token_hash     text UNIQUE,
  subject        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz
);

-- ----------------------------------------------------------------- audit ----

CREATE TABLE IF NOT EXISTS audit_events (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  actor_user_id   uuid,
  actor_client_id uuid,
  action          text NOT NULL,
  subject_type    text,
  subject_id      text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_ws_idx ON audit_events (workspace_id, created_at DESC);

-- ---------------------------------------------- deletion, backup, usage ----

CREATE TABLE IF NOT EXISTS deletion_requests (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  requested_by uuid,
  scope        text NOT NULL CHECK (scope IN ('workspace','project','connection','memory_item')),
  target_id    uuid,
  state        text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','completed','failed')),
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS backups (
  id                uuid PRIMARY KEY,
  workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id        uuid REFERENCES projects (id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('manual','scheduled')),
  format_version    integer NOT NULL,
  byte_size         integer NOT NULL,
  content_hash      text NOT NULL,
  storage_key       text,
  encrypted_archive bytea,
  version_id        uuid,
  created_by        uuid,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_usage (
  id                 uuid PRIMARY KEY,
  workspace_id       uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id         uuid REFERENCES projects (id) ON DELETE SET NULL,
  job_id             uuid,
  operation          text NOT NULL,
  provider           text NOT NULL,
  model              text NOT NULL,
  input_tokens       integer NOT NULL DEFAULT 0,
  output_tokens      integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  cached             boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_usage_month_idx ON model_usage (workspace_id, created_at);

CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id            uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  ai_monthly_budget_usd   numeric(12, 4) NOT NULL DEFAULT 5,
  ai_hard_limit_enabled   boolean NOT NULL DEFAULT true,
  privacy_mode            boolean NOT NULL DEFAULT false,
  retention_days_raw      integer NOT NULL DEFAULT 365,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------------ RLS ----

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'workspaces','memberships','projects','workspace_keys','source_connections',
    'source_items','source_revisions','stored_objects','chunks','chunk_embeddings',
    'memory_items','memory_item_embeddings','memory_blind_terms','memory_evidence',
    'memory_conflicts','memory_proposals','vault_objects','vault_versions','jobs',
    'sync_runs','mcp_clients','audit_events','deletion_requests','backups',
    'model_usage','workspace_settings'
  ];
  id_column text;
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    id_column := CASE WHEN t = 'workspaces' THEN 'id' ELSE 'workspace_id' END;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO cairn_app USING (%I = cairn_current_workspace()) WITH CHECK (%I = cairn_current_workspace())',
      t || '_tenant_isolation', t, id_column, id_column
    );
  END LOOP;
END
$$;

-- `users` is not workspace-scoped; a member may only read themselves.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users FOR ALL TO cairn_app
  USING (id = cairn_current_user()) WITH CHECK (id = cairn_current_user());

-- Sign-in tables are reachable only from the system path.
ALTER TABLE auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO cairn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cairn_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cairn_app;

-- Let the connecting role assume cairn_app. Harmless if already granted.
DO $$
BEGIN
  EXECUTE format('GRANT cairn_app TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$$;
