-- Create indexes for enrichment status columns
CREATE INDEX IF NOT EXISTS "Artist_enrichmentStatus_idx" ON "Artist"("enrichmentStatus");
CREATE INDEX IF NOT EXISTS "Track_analysisStatus_idx" ON "Track"("analysisStatus");

-- vibe analysis status indexes: only create if column exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'Track' AND column_name = 'vibeAnalysisStatus') THEN
        CREATE INDEX IF NOT EXISTS "Track_vibeAnalysisStatus_idx" ON "Track"("vibeAnalysisStatus");
        CREATE INDEX IF NOT EXISTS "Track_analysisStatus_vibeAnalysisStatus_idx" ON "Track"("analysisStatus", "vibeAnalysisStatus");
    ELSE
        RAISE NOTICE 'vibeAnalysisStatus column not found, skipping vibe indexes';
    END IF;
END $$;