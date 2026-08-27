-- Enable pgvector extension for vector similarity search (no-op: pgvector removed)
-- Safe for postgres:16 (no pgvector), existing DBs (vector unavailable), and fresh DBs.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        -- Already have vector, create tables (no-op since we'll drop them anyway)
        RAISE NOTICE 'pgvector already installed';
    ELSE
        -- Try to create extension; if it fails (postgres:16), that's fine
        BEGIN
            CREATE EXTENSION IF NOT EXISTS vector;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pgvector not available (expected on postgres:16): %', SQLERRM;
        END;
    END IF;
END $$;