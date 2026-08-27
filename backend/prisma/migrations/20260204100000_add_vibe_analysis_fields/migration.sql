-- Add vibe analysis status columns to Track table (no-op: vibe features removed)
ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "vibeAnalysisStatus" TEXT DEFAULT 'pending';
ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "vibeAnalysisStartedAt" TIMESTAMP(3);
ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "vibeAnalysisError" TEXT;
ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "vibeAnalysisRetryCount" INTEGER DEFAULT 0;
ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "vibeAnalysisStatusUpdatedAt" TIMESTAMP(3);

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'track_embeddings') THEN
        UPDATE "Track"
        SET "vibeAnalysisStatus" = 'completed',
            "vibeAnalysisStartedAt" = NOW(),
            "vibeAnalysisStatusUpdatedAt" = NOW()
        WHERE EXISTS (
            SELECT 1 FROM track_embeddings te WHERE te.track_id = "Track".id
        );
    ELSE
        RAISE NOTICE 'track_embeddings table not found (expected after pgvector removal)';
    END IF;
END $$;