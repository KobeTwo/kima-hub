-- Drop track_embeddings table (vibe embeddings feature removed)
-- Safe to run on existing databases and fresh databases.

DROP TABLE IF EXISTS "track_embeddings";

DO $$
BEGIN
    DROP EXTENSION IF EXISTS vector;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not drop vector extension (expected if never created): %', SQLERRM;
END $$;