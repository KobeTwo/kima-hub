import { Router } from "express";
import { logger } from "../utils/logger";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { staleJobCleanupService } from "../services/staleJobCleanup";

const router = Router();

router.use(requireAuth);

// POST /settings/cleanup-stale-jobs
router.post("/cleanup-stale-jobs", requireAdmin, async (req, res) => {
    try {
        const result = await staleJobCleanupService.cleanupAll();

        res.json({
            success: true,
            cleaned: {
                discoveryBatches: result.discoveryBatches,
                downloadJobs: result.downloadJobs,
                spotifyImportJobs: result.spotifyImportJobs,
                bullQueues: result.bullQueues,
            },
            totalCleaned: result.totalCleaned,
        });
    } catch (error) {
        logger.error("Stale job cleanup error:", error);
        res.status(500).json({ error: "Failed to cleanup stale jobs" });
    }
});

export default router;
