import { Router } from "express";
import { featureDetection } from "../services/featureDetection";
import { requireAuth } from "../middleware/auth";
import { logger } from "../utils/logger";

const router = Router();

/**
 * GET /api/system/features
 * Returns which features are available
 * Note: musicCNN and vibeEmbeddings are always false (audio analysis removed)
 */
router.get("/features", requireAuth, async (req, res) => {
    try {
        const features = await featureDetection.getFeatures();
        res.json(features);
    } catch (error: any) {
        logger.error("Feature detection error:", error);
        res.status(500).json({ error: "Failed to detect features" });
    }
});

export default router;
