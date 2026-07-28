-- Approximate-nearest-neighbour indexes.
--
-- Separated from the initial schema because these are the only statements whose
-- availability depends on the pgvector build. If a deployment's build lacks HNSW,
-- this migration is the only thing to adjust; semantic search still works without
-- it (exact scan), just slower.

CREATE INDEX IF NOT EXISTS chunk_embeddings_hnsw
  ON chunk_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS memory_item_embeddings_hnsw
  ON memory_item_embeddings USING hnsw (embedding vector_cosine_ops);
