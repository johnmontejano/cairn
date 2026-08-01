-- First-run setup, tracked server-side.
--
-- Setup happens inside whichever AI tool the person connected, not on a web
-- page, so the progress cannot live in a browser session: the next step has to
-- be answerable from a cold MCP call with no cookie and no page history.
--
-- Only two things are stored. Which step they reached, and what they chose to
-- have saved back. Everything else the state machine needs — chiefly whether
-- enough apps are connected — is derived by counting live connections at the
-- moment it is asked, because a stored count would go stale the first time
-- someone disconnected something.
--
-- `setup_step` is text rather than an enum: the sequence is a product decision
-- that will change, and a migration to add a step to an enum is a worse trade
-- than validating the value in code where the sequence already lives.

ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS setup_step         text,
  ADD COLUMN IF NOT EXISTS setup_settled_at   timestamptz,
  ADD COLUMN IF NOT EXISTS save_back_mode     text NOT NULL DEFAULT 'important';

-- Guarded rather than trusted: this value decides whether an assistant may
-- write anything back at all, so a typo must fail loudly at the write.
ALTER TABLE workspace_settings
  DROP CONSTRAINT IF EXISTS workspace_settings_save_back_mode_check;
ALTER TABLE workspace_settings
  ADD CONSTRAINT workspace_settings_save_back_mode_check
  CHECK (save_back_mode IN ('everything', 'important', 'nothing'));
