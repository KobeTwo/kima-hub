-- Add map position columns to track_embeddings (no-op: pgvector removed)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'track_embeddings') THEN
        ALTER TABLE "track_embeddings"
          ADD COLUMN IF NOT EXISTS "map_x" DOUBLE PRECISION,
          ADD COLUMN IF NOT EXISTS "map_y" DOUBLE PRECISION;
    ELSE
        RAISE NOTICE 'track_embeddings table not found (expected after pgvector removal)';
    END IF;
END $$;