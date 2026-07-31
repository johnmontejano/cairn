-- A short summary of who the person is, cheap to read on every request.
--
-- Kept separate from the memory corpus on purpose. An AI client wants this at
-- the start of a session, before it knows what to search for, and reading it
-- must not cost a retrieval pass over every saved item.
--
-- Two columns rather than one:
--
--   * `identity_markdown` is null while the summary is derived from memory. A
--     person can replace it, at which point their text is stored and derivation
--     stops — writing an override then silently regenerating over it would make
--     the edit look lost.
--   * `identity_updated_at` records when the override was written, so the
--     interface can say whose text it is showing and when.
--
-- Length is capped in application code rather than by a column constraint: the
-- limit is a product decision about how much context is worth sending on every
-- request, not a storage one, and a hard database error is the wrong way to
-- report it to someone typing.

ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS identity_markdown   text,
  ADD COLUMN IF NOT EXISTS identity_updated_at timestamptz;
