import { Router, Request, Response } from "express";
import { prisma } from "../utils/db";
import { logger } from "../utils/logger";
import { requireAuth } from "../middleware/auth";
import { randomBytes } from "crypto";
import rateLimit from "express-rate-limit";
import fs from "fs";
import { getLocalImagePath, getResizedImagePath } from "../services/imageStorage";

const router = Router();

const shareResolveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false },
});

/**
 * POST /api/share - Create a share link (authenticated)
 */
router.post("/", requireAuth, async (req: Request, res: Response) => {
    try {
        const { entityType, entityId } = req.body;
        const userId = req.user!.id;

        if (!entityType || !entityId) {
            return res.status(400).json({ error: "entityType and entityId are required" });
        }

        if (!["playlist", "track", "album"].includes(entityType)) {
            return res.status(400).json({ error: "entityType must be playlist, track, or album" });
        }

        if (entityType === "playlist") {
            const playlist = await prisma.playlist.findUnique({ where: { id: entityId } });
            if (!playlist) return res.status(404).json({ error: "Playlist not found" });
            if (playlist.userId !== userId) return res.status(403).json({ error: "Not the playlist owner" });
        } else if (entityType === "track") {
            const track = await prisma.track.findUnique({ where: { id: entityId } });
            if (!track) return res.status(404).json({ error: "Track not found" });
        } else if (entityType === "album") {
            const album = await prisma.album.findUnique({ where: { id: entityId } });
            if (!album) return res.status(404).json({ error: "Album not found" });
        }

        const createShareLink = () => prisma.$transaction(async (tx) => {
            const existing = await tx.shareLink.findFirst({
                where: {
                    entityType,
                    entityId,
                    createdBy: userId,
                    OR: [
                        { expiresAt: null },
                        { expiresAt: { gt: new Date() } },
                    ],
                },
            });

            if (existing) {
                return { token: existing.token, url: `/share/${existing.token}`, existing: true };
            }

            const userLinkCount = await tx.shareLink.count({
                where: {
                    createdBy: userId,
                    OR: [
                        { expiresAt: null },
                        { expiresAt: { gt: new Date() } },
                    ],
                },
            });
            if (userLinkCount >= 500) {
                throw new Error("SHARE_LIMIT_REACHED");
            }

            const shareLink = await tx.shareLink.create({
                data: {
                    token: randomBytes(24).toString("base64url"),
                    entityType,
                    entityId,
                    createdBy: userId,
                },
            });

            return { token: shareLink.token, url: `/share/${shareLink.token}` };
        }, { isolationLevel: "Serializable" });

        let result;
        try {
            result = await createShareLink();
        } catch (retryError: any) {
            if (retryError.code === "P2034") {
                result = await createShareLink();
            } else {
                throw retryError;
            }
        }

        res.json(result);
    } catch (error: any) {
        if (error.message === "SHARE_LIMIT_REACHED") {
            return res.status(429).json({ error: "Share link limit reached (max 500)" });
        }
        logger.error(`[Share] Failed to create share link: ${error.message}`);
        res.status(500).json({ error: "Failed to create share link" });
    }
});

/**
 * GET /api/share/:token - Resolve a share link (public, no auth)
 */
router.get("/:token", shareResolveLimiter, async (req: Request, res: Response) => {
    try {
        const shareLink = await prisma.shareLink.findUnique({
            where: { token: req.params.token },
        });

        if (!shareLink) {
            return res.status(404).json({ error: "Share link not found" });
        }

        if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
            return res.status(410).json({ error: "Share link has expired" });
        }

        let entity: any = null;

        if (shareLink.entityType === "playlist") {
            entity = await prisma.playlist.findUnique({
                where: { id: shareLink.entityId },
                include: {
                    items: {
                        include: {
                            track: {
                                include: {
                                    album: {
                                        include: {
                                            artist: {
                                                select: { id: true, name: true },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        orderBy: { sort: "asc" },
                    },
                    user: { select: { username: true } },
                },
            });
        } else if (shareLink.entityType === "track") {
            entity = await prisma.track.findUnique({
                where: { id: shareLink.entityId },
                include: {
                    album: {
                        include: {
                            artist: { select: { id: true, name: true } },
                        },
                    },
                },
            });
        } else if (shareLink.entityType === "album") {
            entity = await prisma.album.findUnique({
                where: { id: shareLink.entityId },
                include: {
                    artist: { select: { id: true, name: true } },
                    tracks: {
                        orderBy: [
                            { discNumber: { sort: "asc", nulls: "first" } },
                            { trackNo: "asc" },
                        ],
                        select: {
                            id: true,
                            title: true,
                            trackNo: true,
                            discNumber: true,
                            discSubtitle: true,
                            duration: true,
                        },
                    },
                },
            });
        }

        if (!entity) {
            return res.status(404).json({ error: "Shared content no longer exists" });
        }

        res.json({
            entityType: shareLink.entityType,
            entity,
            createdAt: shareLink.createdAt,
        });
    } catch (error: any) {
        logger.error(`[Share] Failed to resolve share link: ${error.message}`);
        res.status(500).json({ error: "Failed to load shared content" });
    }
});

/**
 * GET /api/share/:token/cover-art/:coverArtId - Serve cover art via share token (public)
 */
router.get("/:token/cover-art/:coverArtId", shareResolveLimiter, async (req: Request, res: Response) => {
    try {
        const shareLink = await prisma.shareLink.findUnique({
            where: { token: req.params.token },
        });

        if (!shareLink) {
            return res.status(404).json({ error: "Share link not found" });
        }

        if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
            return res.status(410).json({ error: "Share link has expired" });
        }

        const coverArtId = decodeURIComponent(req.params.coverArtId);
        const size = req.query.size as string | undefined;

        if (!coverArtId.startsWith("native:")) {
            return res.status(404).json({ error: "Cover art not found" });
        }

        const localPath = getLocalImagePath(coverArtId);
        if (!localPath) {
            return res.status(404).json({ error: "Cover art not found" });
        }

        const width = size ? parseInt(size, 10) : 0;
        if (width >= 16 && width <= 2048) {
            const resizedPath = getResizedImagePath(coverArtId, width);
            if (resizedPath) {
                try {
                    await fs.promises.access(resizedPath, fs.constants.R_OK);
                    res.setHeader("Content-Type", "image/jpeg");
                    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
                    return res.sendFile(resizedPath);
                } catch {}
            }
        }

        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        return res.sendFile(localPath);
    } catch (error: any) {
        logger.error(`[Share] Cover art error: ${error.message}`);
        res.status(500).json({ error: "Failed to serve cover art" });
    }
});

/**
 * DELETE /api/share/:token - Revoke a share link (authenticated, owner only)
 */
router.delete("/:token", requireAuth, async (req: Request, res: Response) => {
    try {
        const shareLink = await prisma.shareLink.findUnique({
            where: { token: req.params.token },
        });

        if (!shareLink) {
            return res.status(404).json({ error: "Share link not found" });
        }

        if (shareLink.createdBy !== req.user!.id) {
            return res.status(403).json({ error: "Not the link owner" });
        }

        await prisma.shareLink.delete({ where: { id: shareLink.id } });

        res.json({ message: "Share link revoked" });
    } catch (error: any) {
        logger.error(`[Share] Failed to revoke share link: ${error.message}`);
        res.status(500).json({ error: "Failed to revoke share link" });
    }
});

export default router;
