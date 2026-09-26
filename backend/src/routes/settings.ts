import { Router } from "express";
import { z } from "zod";
import { logger } from "../utils/logger";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { staleJobCleanupService } from "../services/staleJobCleanup";
import {
    getUserNavidromeSettings,
    saveUserNavidromeSettings,
    UserNavidromeSettingsInput,
} from "../utils/userNavidromeSettings";

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

// ---------------------------------------------------------------------------
// Per-User Navidrome Sync: /settings/navidrome-sync/me
// Nur requireAuth — jeder User verwaltet seine eigene Ziel-Config.
// ---------------------------------------------------------------------------

const userNavidromeSyncSchema = z.object({
    enabled: z.boolean().optional(),
    url: z.string().nullable().optional(),
    navidromeUser: z.string().nullable().optional(),
    navidromePassword: z.string().nullable().optional(),
    namePrefix: z.string().optional(),
});

// GET /settings/navidrome-sync/me
router.get("/navidrome-sync/me", async (req, res) => {
    try {
        const settings = await getUserNavidromeSettings(req.user!.id);
        res.json(settings); // null erlaubt
    } catch (error) {
        logger.error("Get personal navidrome sync settings error:", error);
        res.status(500).json({ error: "Failed to get personal Navidrome sync settings" });
    }
});

// POST /settings/navidrome-sync/me
router.post("/navidrome-sync/me", async (req, res) => {
    try {
        const data: UserNavidromeSettingsInput = userNavidromeSyncSchema.parse(
            req.body
        );
        const saved = await saveUserNavidromeSettings(req.user!.id, data);
        res.json(saved);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                error: "Invalid request",
                details: error.errors,
            });
        }
        logger.error("Save personal navidrome sync settings error:", error);
        res.status(500).json({ error: "Failed to save personal Navidrome sync settings" });
    }
});

// POST /settings/navidrome-sync/me/test
router.post("/navidrome-sync/me/test", async (req, res) => {
    try {
        const { url, username, password } = req.body as {
            url?: string;
            username?: string;
            password?: string;
        };
        if (!url || !username || !password) {
            return res
                .status(400)
                .json({ error: "URL, username and password are required" });
        }

        const { navidromeSync } = await import("../services/navidromeSync");
        const result = await navidromeSync.testConnection(url, username, password);

        if (!result.ok) {
            return res.status(502).json({
                error: result.error || "Connection failed",
            });
        }
        res.json({ success: true, message: "Navidrome connection successful" });
    } catch (error) {
        logger.error("Personal navidrome connection test error:", error);
        res.status(500).json({ error: "Connection test failed" });
    }
});

// POST /settings/navidrome-sync/me/sync-now
router.post("/navidrome-sync/me/sync-now", async (req, res) => {
    try {
        const { navidromeSync } = await import("../services/navidromeSync");
        const results = await navidromeSync.syncUserPlaylists(req.user!.id);
        res.json({ success: true, results });
    } catch (error) {
        logger.error("Personal navidrome sync trigger error:", error);
        res.status(500).json({ error: "Sync trigger failed" });
    }
});

export default router;
