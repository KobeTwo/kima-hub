-- Drop track_embeddings table (vibe embeddings feature removed)
-- Safe to run on existing databases (table may not exist if already dropped)
-- and on fresh databases (table never gets created after model removal).

DROP TABLE IF EXISTS "track_embeddings";

-- Drop pgvector extension if no other objects depend on it
-- (track_embeddings was the only user of the vector type)
DROP EXTENSION IF EXISTS vector;