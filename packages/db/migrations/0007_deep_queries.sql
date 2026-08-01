-- Deep queries, which take longer than a request should wait for.
--
-- Retrieval answers in a moment. Synthesis across everything a person has saved
-- does not, and an MCP client that blocks for a minute looks broken. So the
-- question is written down, a job picks it up, and the caller polls an id.
--
-- The answer is stored as text rather than assembled on read because it is
-- expensive to produce and cheap to keep, and because a person who asks the
-- same question twice should get the same answer rather than a new one that
-- differs for reasons they cannot see.
--
-- `evidence_count` is stored alongside so the reader can tell a confident
-- answer from one built on two fragments without parsing the prose.
--
-- Encrypted like everything else derived from user content: the question itself
-- discloses what someone is worried about, which is often more sensitive than
-- the answer.

CREATE TABLE IF NOT EXISTS deep_queries (
  id                uuid NOT NULL,
  workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id        uuid REFERENCES projects (id) ON DELETE CASCADE,
  state             text NOT NULL DEFAULT 'pending'
                      CHECK (state IN ('pending', 'running', 'ready', 'failed')),
  encrypted_question bytea NOT NULL,
  encrypted_answer   bytea,
  evidence_count    integer NOT NULL DEFAULT 0,
  -- True when the answer was produced while ingestion still had work queued,
  -- so the reader can be told the picture was incomplete at the time.
  indexing_pending  boolean NOT NULL DEFAULT false,
  error_message     text,
  asked_by          uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS deep_queries_pending_idx
  ON deep_queries (workspace_id, state, created_at DESC);

ALTER TABLE deep_queries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deep_queries_tenant_isolation ON deep_queries;
CREATE POLICY deep_queries_tenant_isolation ON deep_queries FOR ALL TO cairn_app
  USING (workspace_id = cairn_current_workspace())
  WITH CHECK (workspace_id = cairn_current_workspace());

GRANT SELECT, INSERT, UPDATE, DELETE ON deep_queries TO cairn_app;
