-- Which kinds of memory a connected AI may read.
--
-- Until now a connection was scoped two ways: by project, and by a ceiling on
-- sensitivity. Neither answers the question people actually ask, which is not
-- "how secret is this" but "what is this about". A coding assistant has a good
-- reason to read operating rules and preferences and no reason at all to read
-- who someone's family is, and that difference does not follow from either
-- existing axis — none of it is sensitive, and it all lives in one project.
--
-- Null means every type, matching `project_ids` above it: an existing
-- connection keeps reading exactly what it read before this column existed, and
-- the narrowing is something a person opts into rather than something a
-- migration silently does to connections they already trust.
--
-- Stored as text[] rather than an enum for the same reason `scopes` is: adding
-- a memory type is an application change, and an enum would make it a migration
-- with a lock on a table read on every authorized request.

ALTER TABLE mcp_clients
  ADD COLUMN IF NOT EXISTS memory_types text[];
