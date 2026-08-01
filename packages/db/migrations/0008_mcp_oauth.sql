-- Remote MCP authorization: Cairn as its own OAuth 2.1 authorization server.
--
-- Why Cairn issues the tokens rather than delegating to WorkOS.
--
-- The previous design read an access token minted by an external issuer and
-- looked the caller up by its `sub` claim (`mcp_clients.subject`). Nothing in
-- the application ever wrote that column, so the lookup could not match and
-- every OAuth request failed regardless of which issuer was configured. The
-- missing half was never the token verification; it was the grant that decides
-- *which workspace and which scopes* a given AI client may use — and that
-- decision belongs to the person, on a Cairn page, not to an identity provider
-- that knows nothing about memory scopes.
--
-- Delegating human sign-in stays exactly as it was: the authorize endpoint
-- requires a live Cairn session, which WorkOS backs. Cairn authenticates
-- nobody here; it only records what an already-signed-in person consented to.
--
-- Tokens are opaque and stored as SHA-256 hashes rather than signed JWTs. The
-- specification requires that a resource server validate the token's audience,
-- not that the token be a JWT. Since Cairn is both the issuer and the resource
-- server, binding the audience to a row at issue time is a stronger check than
-- re-parsing a claim, and it means no signing key to generate, distribute,
-- rotate, or leak. It also reuses the connection-code pattern already proven
-- here: a database copy holds nothing replayable.

-- Registered OAuth clients.
--
-- Deliberately NOT workspace-scoped. A client registers once (Claude, Cursor,
-- ChatGPT), and any number of people then authorize it against their own
-- workspace. Everything in this table is public OAuth client metadata by
-- definition — RFC 7591 registration responses and Client ID Metadata
-- Documents are both readable by anyone — so the row-level policy is
-- permissive on purpose rather than by omission. No client secret is stored:
-- OAuth 2.1 requires PKCE for public clients, and every MCP client is one.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id         text PRIMARY KEY,
  client_name       text NOT NULL,
  redirect_uris     text[] NOT NULL,
  client_uri        text,
  -- 'dynamic'        RFC 7591 registration (deprecated by the spec, still what
  --                  most shipping clients do today)
  -- 'client_id_doc'  the client_id is itself an HTTPS URL serving its metadata
  registration_type text NOT NULL DEFAULT 'dynamic'
                      CHECK (registration_type IN ('dynamic', 'client_id_doc')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Refreshed when a Client ID Metadata Document is re-fetched, so a client
  -- that changes its redirect URIs is not pinned to a stale copy forever.
  metadata_fetched_at timestamptz
);

ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oauth_clients_readable ON oauth_clients;
CREATE POLICY oauth_clients_readable ON oauth_clients FOR ALL TO cairn_app
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_clients TO cairn_app;

-- Authorization codes.
--
-- Single use, short lived, and bound to four things at once: the client that
-- asked, the redirect URI it asked with, the PKCE challenge it committed to,
-- and the resource the token will be valid for. `consumed_at` is set rather
-- than the row deleted so that a replayed code is distinguishable from an
-- expired one in the audit trail.
CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id             uuid NOT NULL,
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  code_hash      text NOT NULL UNIQUE,
  oauth_client_id text NOT NULL REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
  -- The mcp_clients row this grant will act as. Created at consent time so
  -- revocation, listing and audit all keep working through the existing path.
  mcp_client_id  uuid NOT NULL,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,
  -- S256 only. OAuth 2.1 removes `plain`, and accepting it would defeat the
  -- point of the challenge on exactly the clients that need it most.
  code_challenge_method text NOT NULL DEFAULT 'S256'
                          CHECK (code_challenge_method = 'S256'),
  scopes         text[] NOT NULL,
  resource       text NOT NULL,
  granted_by     uuid,
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS oauth_codes_expiry_idx
  ON oauth_authorization_codes (expires_at);

ALTER TABLE oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oauth_codes_tenant_isolation ON oauth_authorization_codes;
CREATE POLICY oauth_codes_tenant_isolation ON oauth_authorization_codes FOR ALL TO cairn_app
  USING (workspace_id = cairn_current_workspace())
  WITH CHECK (workspace_id = cairn_current_workspace());

GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_authorization_codes TO cairn_app;

-- Access and refresh tokens, in one table.
--
-- They differ only in lifetime and in what they may be exchanged for, so two
-- tables would duplicate every column and every revocation path. `kind` keeps
-- them apart. Only the hash is stored, so this table cannot be read back into
-- a working credential.
--
-- `resource` is the audience check the specification requires: a token minted
-- for one MCP server is refused at another even though the signature — here,
-- the hash lookup — would otherwise succeed.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id             uuid NOT NULL,
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('access', 'refresh')),
  token_hash     text NOT NULL UNIQUE,
  oauth_client_id text NOT NULL REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
  mcp_client_id  uuid NOT NULL,
  scopes         text[] NOT NULL,
  resource       text NOT NULL,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  -- Refresh tokens rotate: using one issues a replacement and points the old
  -- row at it. A second use of an already-rotated token is the signature of a
  -- stolen token, and is handled by revoking the whole chain rather than by
  -- silently issuing another.
  rotated_to     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS oauth_tokens_client_idx
  ON oauth_tokens (mcp_client_id, kind);
CREATE INDEX IF NOT EXISTS oauth_tokens_expiry_idx
  ON oauth_tokens (expires_at);

ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oauth_tokens_tenant_isolation ON oauth_tokens;
CREATE POLICY oauth_tokens_tenant_isolation ON oauth_tokens FOR ALL TO cairn_app
  USING (workspace_id = cairn_current_workspace())
  WITH CHECK (workspace_id = cairn_current_workspace());

GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_tokens TO cairn_app;

-- Which registered client an mcp_clients row was created for, when it came
-- from an OAuth grant rather than from someone copying a connection code.
-- Null for connection-code clients, which keeps both paths in one table and
-- one revocation story.
ALTER TABLE mcp_clients ADD COLUMN IF NOT EXISTS oauth_client_id text;
