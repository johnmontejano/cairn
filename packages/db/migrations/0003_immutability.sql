-- Canonical history is append-only.
--
-- Enforced by the database rather than by convention, because "we never update
-- that table" is exactly the kind of rule an ORM helper quietly breaks. UPDATE is
-- blocked; DELETE is deliberately left alone so that workspace deletion and
-- retention policy remain honest and actually remove data.

CREATE OR REPLACE FUNCTION cairn_block_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % are immutable; write a new row instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$$;

DROP TRIGGER IF EXISTS vault_versions_immutable ON vault_versions;
CREATE TRIGGER vault_versions_immutable
  BEFORE UPDATE ON vault_versions
  FOR EACH ROW EXECUTE FUNCTION cairn_block_update();

DROP TRIGGER IF EXISTS vault_objects_immutable ON vault_objects;
CREATE TRIGGER vault_objects_immutable
  BEFORE UPDATE ON vault_objects
  FOR EACH ROW EXECUTE FUNCTION cairn_block_update();

DROP TRIGGER IF EXISTS memory_evidence_immutable ON memory_evidence;
CREATE TRIGGER memory_evidence_immutable
  BEFORE UPDATE ON memory_evidence
  FOR EACH ROW EXECUTE FUNCTION cairn_block_update();

DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION cairn_block_update();
