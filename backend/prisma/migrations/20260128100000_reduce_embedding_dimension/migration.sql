-- Reduce embedding dimension from 1024 to 512 (no-op: pgvector removed)
-- Safe for postgres:16 (no vector type) and existing DBs.

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'track_embeddings') THEN
        DROP TABLE IF EXISTS "track_embeddings";
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not drop track_embeddings (expected if vector unavailable): %', SQLERRM;
END $$;