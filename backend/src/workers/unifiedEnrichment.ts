/**
 * Unified Enrichment Worker
 *
 * Handles enrichment:
 * - Artist metadata (Last.fm, MusicBrainz)
 * - Track mood tags (Last.fm)
 */

import { logger } from "../utils/logger";
import { Prisma } from "@prisma/client";
import { prisma } from "../utils/db";
import { lastFmService } from "../services/lastfm";
import Redis from "ioredis";
import { config } from "../config";
import path from "path";
import type { Worker as BullWorker } from "bullmq";
import {
    artistQueue,
    trackQueue,
    vibeQueue,
    podcastQueue,
    closeEnrichmentQueues,
} from "./enrichmentQueues";
import { startArtistEnrichmentWorker } from "./artistEnrichmentWorker";
import { startTrackEnrichmentWorker } from "./trackEnrichmentWorker";
import { startPodcastEnrichmentWorker } from "./podcastEnrichmentWorker";
import { enrichmentStateService } from "../services/enrichmentState";
import { enrichmentFailureService } from "../services/enrichmentFailureService";
import { musicBrainzService } from "../services/musicbrainz";
import { trackIdentityService } from "../services/trackIdentity";
import fs from "fs";

// Configuration
const ARTIST_BATCH_SIZE = 10;
const TRACK_BATCH_SIZE = 20;
const ENRICHMENT_INTERVAL_MS = 5 * 1000; // 5 seconds - rate limiter handles API limits
// Backoff window for a failed enrichment job. A failed job keeps its jobId
// marker, and the phases skip an entity whose jobId is still held (getJob
// check), so a failure backs off until this grace elapses and the failed job
// is cleaned -- then the slot is free and the entity retries. Without the grace
// a failure would retry every 5s cycle; without the getJob skip it would park
// out of selection until restart. Completed jobs are cleaned with grace 0 -- a
// success should be immediately re-queueable if the entity is legitimately reset.
const FAILED_JOB_RETRY_GRACE_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CONSECUTIVE_SYSTEM_FAILURES = 5; // Circuit breaker threshold

let isRunning = false;
let enrichmentInterval: NodeJS.Timeout | null = null;
let redis: Redis | null = null;
let controlSubscriber: Redis | null = null;
let isPaused = false;
let isStopping = false;
let userStopped = false; // True after explicit stop; prevents auto-restart via timer
let userStoppedWarned = false; // Throttle warning log to once per stop
let immediateEnrichmentRequested = false;
let activeEnrichmentWorkers: BullWorker[] = [];
let consecutiveSystemFailures = 0; // Track consecutive system-level failures
let lastRunTime = 0;
const MIN_INTERVAL_MS = 10000; // Minimum 10s between cycles

// Timestamp for once-per-hour orphaned failure record cleanup
let lastOrphanedFailuresCleanup: Date | null = null;

// Timestamp for once-per-day resolved failure record cleanup (>30 days old)
let lastResolvedCleanup: Date | null = null;

/**
 * Reset all pause/stop flags and resume the Python audio analyzer.
 * Called by every function that (re)starts enrichment.
 */
async function clearPauseState(): Promise<void> {
    isPaused = false;
    isStopping = false;
    userStopped = false;
    userStoppedWarned = false;
    Promise.all(activeEnrichmentWorkers.map((w) => w.resume())).catch(() => {});
}

// Mood tags to extract from Last.fm
const MOOD_TAGS = new Set([
    // Energy/Activity
    "chill",
    "relax",
    "relaxing",
    "calm",
    "peaceful",
    "ambient",
    "energetic",
    "upbeat",
    "hype",
    "party",
    "dance",
    "workout",
    "gym",
    "running",
    "exercise",
    "motivation",
    // Emotions
    "sad",
    "melancholy",
    "melancholic",
    "depressing",
    "heartbreak",
    "happy",
    "feel good",
    "feel-good",
    "joyful",
    "uplifting",
    "angry",
    "aggressive",
    "intense",
    "romantic",
    "love",
    "sensual",
    // Time/Setting
    "night",
    "late night",
    "evening",
    "morning",
    "summer",
    "winter",
    "rainy",
    "sunny",
    "driving",
    "road trip",
    "travel",
    // Activity
    "study",
    "focus",
    "concentration",
    "work",
    "sleep",
    "sleeping",
    "bedtime",
    // Vibe
    "dreamy",
    "atmospheric",
    "ethereal",
    "spacey",
    "groovy",
    "funky",
    "smooth",
    "dark",
    "moody",
    "brooding",
    "epic",
    "cinematic",
    "dramatic",
    "nostalgic",
    "throwback",
]);

/**
 * Timeout wrapper to prevent operations from hanging indefinitely
 * If an operation takes longer than the timeout, it will fail and move to the next item
 */
async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage: string,
): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

/**
 * Filter tags to only include mood-relevant ones
 */
function filterMoodTags(tags: string[]): string[] {
    return tags
        .map((t) => t.toLowerCase().trim())
        .filter((t) => {
            if (MOOD_TAGS.has(t)) return true;
            for (const mood of MOOD_TAGS) {
                if (t.includes(mood)) return true;
            }
            return false;
        })
        .slice(0, 10);
}

/**
 * Initialize Redis connection for audio analysis queue
 */
function getRedis(): Redis {
    if (!redis) {
        redis = new Redis(config.redisUrl);
    }
    return redis;
}

/**
 * Setup subscription to enrichment control channel
 */
async function setupControlChannel() {
    if (!controlSubscriber) {
        controlSubscriber = new Redis(config.redisUrl);
        await controlSubscriber.subscribe("enrichment:control");

        controlSubscriber.on("message", (channel, message) => {
            if (channel === "enrichment:control") {
                logger.debug(
                    `[Enrichment] Received control message: ${message}`,
                );

                if (message === "pause") {
                    isPaused = true;
                    logger.debug("[Enrichment] Paused");
                    Promise.all(activeEnrichmentWorkers.map((w) => w.pause())).catch(() => {});
                } else if (message === "resume") {
                    isPaused = false;
                    logger.debug("[Enrichment] Resumed");
                    Promise.all(activeEnrichmentWorkers.map((w) => w.resume())).catch(() => {});
                } else if (message === "stop") {
                    isStopping = true;
                    isPaused = true;
                    logger.debug(
                        "[Enrichment] Stopping gracefully - completing current item...",
                    );
                    Promise.all(activeEnrichmentWorkers.map((w) => w.pause())).catch(() => {});
                }
            }
        });

        logger.debug("[Enrichment] Subscribed to control channel");
    }
}

/**
 * Start the unified enrichment worker (incremental mode)
 */
export async function startUnifiedEnrichmentWorker() {
    logger.debug("\n=== Starting Unified Enrichment Worker ===");
    logger.debug(`   Artist batch: ${ARTIST_BATCH_SIZE}`);
    logger.debug(`   Track batch: ${TRACK_BATCH_SIZE}`);
    logger.debug(`   Interval: ${ENRICHMENT_INTERVAL_MS / 1000}s`);
    logger.debug("");

     // Crash recovery: reset orphaned entities stuck mid-processing from a previous crash
     const orphanedArtists = await prisma.artist.updateMany({
         where: { enrichmentStatus: "enriching" },
         data: { enrichmentStatus: "pending" },
     });
     const orphanedQueued = await prisma.track.updateMany({
         where: { lastfmTags: { has: "_queued" } },
         data: { lastfmTags: [] },
     });
     // Crash recovery: reset tracks stuck in "validating" (scan queue may be lost)
     const orphanedScan = await prisma.track.updateMany({
         where: { scanStatus: "validating" },
         data: { scanStatus: "pending", scanError: null },
     });
     const totalOrphaned = orphanedArtists.count + orphanedQueued.count + orphanedScan.count;
     if (totalOrphaned > 0) {
         logger.info(
             `[Enrichment] Crash recovery: reset ${orphanedArtists.count} artists, ${orphanedQueued.count} _queued, ${orphanedScan.count} scan tracks`
         );
     }

     // Reset local flags from any previous session
     isPaused = false;
     isStopping = false;
     userStopped = false;

     // Check if there's existing state that might be problematic
     const existingState = await enrichmentStateService.getState();

     // Only clear state if it exists and is in a non-idle state
     // This prevents clearing fresh state from a previous worker instance
     if (existingState && existingState.status !== "idle") {
         await enrichmentStateService.clear();
     }

     // Initialize state
     await enrichmentStateService.initializeState();

    // Start BullMQ Workers (artist, track, podcast)
    activeEnrichmentWorkers = await Promise.all([
        startArtistEnrichmentWorker(),
        startTrackEnrichmentWorker(),
        startPodcastEnrichmentWorker(),
    ]);

    // Setup control channel subscription
    await setupControlChannel();

    // Run immediately
    await runEnrichmentCycle(false);

    // Self-rescheduling: schedule next cycle after current one completes
    scheduleNextEnrichmentCycle();
}

/**
 * Schedule the next enrichment cycle after the current one completes.
 * Replaces setInterval to prevent pile-up when cycles exceed ENRICHMENT_INTERVAL_MS.
 */
function scheduleNextEnrichmentCycle() {
    enrichmentInterval = setTimeout(async () => {
        await runEnrichmentCycle(false);
        scheduleNextEnrichmentCycle();
    }, ENRICHMENT_INTERVAL_MS);
}

/**
 * Stop the enrichment worker
 */
export async function stopUnifiedEnrichmentWorker() {
    if (enrichmentInterval) {
        clearTimeout(enrichmentInterval);
        enrichmentInterval = null;
        logger.debug("[Enrichment] Worker stopped");
    }
    if (redis) {
        redis.disconnect();
        redis = null;
    }
    if (controlSubscriber) {
        controlSubscriber.disconnect();
        controlSubscriber = null;
    }

    // Close BullMQ Workers and Queues
    await Promise.all(activeEnrichmentWorkers.map((w) => w.close())).catch(() => {});
    activeEnrichmentWorkers = [];
    await closeEnrichmentQueues().catch(() => {});

    // Mark as stopped in state
    await enrichmentStateService
        .updateState({
            status: "idle",
            currentPhase: null,
        })
        .catch((err) =>
            logger.error("[Enrichment] Failed to update state:", err),
        );
}

/**
 * Run a full enrichment (re-enrich everything regardless of status)
 * Called from Settings > Enrich All
 */
export async function runFullEnrichment(): Promise<{
    artists: number;
    tracks: number;
}> {
    logger.debug("\n=== FULL ENRICHMENT: Re-enriching everything ===\n");

    await clearPauseState();

    // Initialize state for new enrichment
    await enrichmentStateService.initializeState();

    // Reset all statuses to pending
    await prisma.artist.updateMany({
        where: { enrichmentStatus: { not: "processing" } },
        data: { enrichmentStatus: "pending" },
    });

    await prisma.track.updateMany({
        where: { analysisStatus: { not: "processing" } },
        data: {
            lastfmTags: [],
            analysisStatus: "pending",
            analysisRetryCount: 0,
            analysisError: null,
        },
    });

    // Now run the enrichment cycle
    const result = await runEnrichmentCycle(true);

    return result;
}

/**
 * Reset only artist enrichment (keeps mood tags and audio analysis intact)
 * Used when user wants to re-fetch artist metadata without touching track data
 */
export async function resetArtistsOnly(): Promise<{ count: number }> {
    logger.debug("[Enrichment] Resetting ONLY artist enrichment status...");

    const result = await prisma.artist.updateMany({
        where: { enrichmentStatus: { in: ["completed", "unresolvable"] } },
        data: {
            enrichmentStatus: "pending",
            lastEnriched: null,
        },
    });

    logger.debug(`[Enrichment] Reset ${result.count} artists to pending`);
    return { count: result.count };
}

/**
 * Reset only mood tags (keeps artist metadata and audio analysis intact)
 * Used when user wants to re-fetch Last.fm mood tags without touching other enrichment
 */
export async function resetMoodTagsOnly(): Promise<{ count: number }> {
    logger.debug("[Enrichment] Resetting ONLY mood tags...");

    const result = await prisma.track.updateMany({
        data: { lastfmTags: [] },
    });

    logger.debug(`[Enrichment] Reset mood tags for ${result.count} tracks`);
    return { count: result.count };
}

/**
 * Main enrichment cycle
 *
 * Flow:
 * 1. Artist metadata (Last.fm/MusicBrainz)
 * 2. Track tags (Last.fm mood tags)
 *
 * @param fullMode - If true, processes everything. If false, only pending items.
 */
async function runEnrichmentCycle(fullMode: boolean): Promise<{
    artists: number;
    tracks: number;
}> {
    const emptyResult = { artists: 0, tracks: 0 };

    // Handle stopping state: transition to idle before checking isPaused.
    // This must run first because stop sets both isStopping AND isPaused.
    // If we checked isPaused first, we'd return early and never clear isStopping.
    if (isStopping) {
        await enrichmentStateService.updateState({ status: "idle", currentPhase: null });
        isStopping = false;
        isPaused = false;
        userStopped = true;
        return emptyResult;
    }

    // User explicitly stopped -- don't auto-restart via timer.
    // Only explicit actions (re-run, full enrich, triggerEnrichmentNow) clear this.
    if (userStopped && !fullMode && !immediateEnrichmentRequested) {
        if (!userStoppedWarned) {
            const pendingCount = await prisma.track.count({ where: { analysisStatus: "pending" } });
            if (pendingCount > 0) {
                logger.warn(`[Enrichment] userStopped=true but ${pendingCount} tracks are pending. Use "Run Enrichment" or "Full Enrichment" to resume.`);
                userStoppedWarned = true;
            }
        }
        return emptyResult;
    }

    // Sync local flags with state service (fallback for missed control messages)
    if (isPaused) {
        // Reverse sync: if state says running but local isPaused is true, resume
        const state = await enrichmentStateService.getState();
        if (state?.status === "running") {
            isPaused = false;
            logger.debug("[Enrichment] Reverse sync: state is running, clearing stale local pause");
        }
    } else {
        const state = await enrichmentStateService.getState();
        if (state?.status === "paused") {
            isPaused = true;
        } else if (state?.status === "stopping") {
            // State says stopping but we missed the control message
            await prisma.track.updateMany({
                where: { analysisStatus: "processing" },
                data: { analysisStatus: "pending", analysisStartedAt: null, analysisRetryCount: 0 },
            });
            await prisma.track.updateMany({
                where: { vibeAnalysisStatus: "processing" },
                data: { vibeAnalysisStatus: "pending", vibeAnalysisStartedAt: null },
            });
            await enrichmentStateService.updateState({ status: "idle", currentPhase: null });
            userStopped = true;
            return emptyResult;
        }
    }

    if (isPaused) {
        return emptyResult;
    }

    // Never allow concurrent runs
    if (isRunning) {
        return emptyResult;
    }

    // Enforce minimum interval (unless full mode or immediate request)
    const bypassIntervalCheck = fullMode || immediateEnrichmentRequested;
    const now = Date.now();
    if (!bypassIntervalCheck && now - lastRunTime < MIN_INTERVAL_MS) {
        return emptyResult;
    }

    immediateEnrichmentRequested = false;
    lastRunTime = now;

    // Detect hangs: warn if enrichment has been "running" > 15 min with no state update
    const isHung = await enrichmentStateService.detectHang();
    if (isHung) {
        logger.warn("[Enrichment] Hang detected — enrichment has been running > 15 min with no activity");
    }

    isRunning = true;

    let artistsProcessed = 0;
    let tracksProcessed = 0;

    try {
        consecutiveSystemFailures = 0;

        const artistResult = await runPhase("artists", executeArtistsPhase);
        if (artistResult === null) {
            return { artists: 0, tracks: 0 };
        }
        artistsProcessed = artistResult;

        const trackResult = await runPhase("tracks", executeMoodTagsPhase);
        if (trackResult === null) {
            return { artists: artistsProcessed, tracks: 0 };
        }
        tracksProcessed = trackResult;

        const scanResult = await runPhase("scan", executeScanPhase);
        if (scanResult === null) {
            return { artists: artistsProcessed, tracks: tracksProcessed };
        }

        await runPhase("podcasts", executePodcastRefreshPhase);

        // Orphaned failure cleanup -- runs at most once per hour, never during stop/pause
        const ONE_HOUR_MS = 60 * 60 * 1000;
        if (!isStopping && !isPaused && (!lastOrphanedFailuresCleanup || Date.now() - lastOrphanedFailuresCleanup.getTime() > ONE_HOUR_MS)) {
            await enrichmentFailureService.cleanupOrphanedFailures();
            lastOrphanedFailuresCleanup = new Date();
        }

        // Daily: clean up old resolved failures (>30 days)
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        if (!isStopping && !isPaused && (!lastResolvedCleanup || Date.now() - lastResolvedCleanup.getTime() > ONE_DAY_MS)) {
            lastResolvedCleanup = new Date();
            await enrichmentFailureService.cleanupOldResolved();
        }

         // Log progress (only if work was done)
         if (artistsProcessed > 0 || tracksProcessed > 0) {
            const progress = await getEnrichmentProgress();
            logger.debug(`\n[Enrichment Progress]`);
            logger.debug(
                `   Artists: ${progress.artists.completed}/${progress.artists.total} (${progress.artists.progress}%)`,
            );
            logger.debug(
                `   Track Tags: ${progress.trackTags.enriched}/${progress.trackTags.total} (${progress.trackTags.progress}%)`,
            );
            logger.debug("");

            await enrichmentStateService.updateState({
                artists: {
                    total: progress.artists.total,
                    completed: progress.artists.completed,
                    failed: progress.artists.failed,
                },
                tracks: {
                    total: progress.trackTags.total,
                    completed: progress.trackTags.enriched,
                    failed: 0,
                },
                completionNotificationSent: false,
            });
        }

        // If everything is complete, mark as idle and send notification (only once)
        const progress = await getEnrichmentProgress();

        // Clear mixes cache when core enrichment completes (artist images now available)
        if (progress.coreComplete) {
            const state = await enrichmentStateService.getState();
            if (!state?.coreCacheCleared) {
                try {
                    const redisInstance = getRedis();
                    const mixKeys: string[] = [];
                    let scanCursor = "0";
                    do {
                        const [nextCursor, batch] = await redisInstance.scan(scanCursor, "MATCH", "mixes:*", "COUNT", 100);
                        scanCursor = nextCursor;
                        mixKeys.push(...batch);
                    } while (scanCursor !== "0");
                    if (mixKeys.length > 0) {
                        await redisInstance.del(...mixKeys);
                        logger.info(
                            `[Enrichment] Cleared ${mixKeys.length} mix cache entries after core enrichment complete`,
                        );
                    }
                    await enrichmentStateService.updateState({
                        coreCacheCleared: true,
                    });
                } catch (error) {
                    logger.error(
                        "[Enrichment] Failed to clear mix cache on core complete:",
                        error,
                    );
                }
            }
        }

        if (progress.isFullyComplete) {
            const stateBeforeNotify = await enrichmentStateService.getState();

            if (!stateBeforeNotify?.fullCacheCleared) {
                try {
                    const redisInstance = getRedis();
                    const mixKeys: string[] = [];
                    let scanCursor = "0";
                    do {
                        const [nextCursor, batch] = await redisInstance.scan(scanCursor, "MATCH", "mixes:*", "COUNT", 100);
                        scanCursor = nextCursor;
                        mixKeys.push(...batch);
                    } while (scanCursor !== "0");
                    if (mixKeys.length > 0) {
                        await redisInstance.del(...mixKeys);
                        logger.info(
                            `[Enrichment] Cleared ${mixKeys.length} mix cache entries after full enrichment complete`,
                        );
                    }
                    await enrichmentStateService.updateState({
                        fullCacheCleared: true,
                    });
                } catch (error) {
                    logger.error(
                        "[Enrichment] Failed to clear mix cache on full complete:",
                        error,
                    );
                }
            }

            if (!stateBeforeNotify?.completionNotificationSent) {
                try {
                    const { notificationService } = await import("../services/notificationService");
                    const users = await prisma.user.findMany({ select: { id: true } });
                    const failureCounts = await enrichmentFailureService.getFailureCounts();

                    for (const user of users) {
                        if (failureCounts.total > 0) {
                            const parts: string[] = [];
                            if (failureCounts.artist > 0) parts.push(`${failureCounts.artist} artist(s)`);
                            if (failureCounts.track > 0) parts.push(`${failureCounts.track} track(s)`);
                            if (failureCounts.podcast > 0) parts.push(`${failureCounts.podcast} podcast(s)`);

                            await notificationService.create({
                                userId: user.id,
                                type: "error",
                                title: "Enrichment Completed with Errors",
                                message: `${failureCounts.total} failures: ${parts.join(", ")}. Check Settings > Enrichment for details.`,
                            });
                        }

                        await notificationService.notifySystem(
                            user.id,
                            "Enrichment Complete",
                            `Enriched ${progress.artists.completed} artists, ${progress.trackTags.enriched} tracks`,
                        );
                    }

                    await enrichmentStateService.updateState({ completionNotificationSent: true });
                    logger.debug("[Enrichment] Completion notification sent");
                } catch (error) {
                    logger.error("[Enrichment] Failed to send completion notification:", error);
                }
            }
        }
    } catch (error) {
        logger.error("[Enrichment] Cycle error:", error);

        // Increment system failure counter
        consecutiveSystemFailures++;

        // Circuit breaker: Stop recording system failures after threshold
        // This prevents infinite error loops when state management fails
        if (consecutiveSystemFailures <= MAX_CONSECUTIVE_SYSTEM_FAILURES) {
            // Record system-level failure
            await enrichmentFailureService
                .recordFailure({
                    entityType: "artist", // Generic type for system errors
                    entityId: "system",
                    entityName: "Enrichment System",
                    errorMessage:
                        error instanceof Error ? error.message : String(error),
                    errorCode: "SYSTEM_ERROR",
                })
                .catch((err) =>
                    logger.error("[Enrichment] Failed to record failure:", err),
                );
        } else {
            logger.error(
                `[Enrichment] Circuit breaker triggered - ${consecutiveSystemFailures} consecutive system failures. ` +
                    `Suppressing further error recording to prevent infinite loop.`,
            );
        }
    } finally {
        isRunning = false;
    }

    return { artists: artistsProcessed, tracks: tracksProcessed };
}


/**
 * Enrich a single track's tags from Last.fm.
 * Used by the BullMQ track enrichment Worker (Phase 4).
 */
export async function enrichSingleTrack(trackId: string): Promise<void> {
    const track = await prisma.track.findUnique({
        where: { id: trackId },
        include: {
            album: {
                include: {
                    artist: { select: { name: true } },
                },
            },
        },
    });

    if (!track) {
        const err = new Error(`ENTITY_NOT_FOUND: Track ${trackId} deleted`);
        (err as any).entityNotFound = true;
        throw err;
    }

    const artistName = track.album.artist.name;
    const trackInfo = await withTimeout(
        lastFmService.getTrackInfo(artistName, track.title),
        30000,
        `Timeout enriching track: ${track.title}`,
    );

    if (trackInfo?.toptags?.tag) {
        const allTags = trackInfo.toptags.tag.map((t: any) => t.name);
        const moodTags = filterMoodTags(allTags);
        await prisma.track.update({
            where: { id: track.id },
            data: {
                lastfmTags: moodTags.length > 0 ? moodTags : ["_no_mood_tags"],
            },
        });
        if (moodTags.length > 0) {
            logger.debug(`   ✓ ${track.title}: [${moodTags.slice(0, 3).join(", ")}...]`);
        }
    } else {
        await prisma.track.update({
            where: { id: track.id },
            data: { lastfmTags: ["_not_found"] },
        });
    }

    // ISRC enrichment: if track has no ISRC, try MusicBrainz lookup
    if (!track.isrc) {
        try {
            const recording = await musicBrainzService.searchRecording(
                track.title,
                track.album.artist.name,
            );
            if (recording) {
                const isrcData = await musicBrainzService.getRecordingIsrc(recording.trackMbid);
                if (isrcData) {
                    await trackIdentityService.storeIsrc(track.id, isrcData, "musicbrainz");
                }
                const genreData = await musicBrainzService.getRecordingGenres(recording.trackMbid);
                if (genreData && genreData.genres.length > 0) {
                    const topGenres = genreData.genres
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 5)
                        .map((g) => g.name);
                    await trackIdentityService.populateTrackGenres(track.id, topGenres);
                }
            }
        } catch (err) {
            logger.debug(`[Track Enrichment] ISRC lookup failed for ${track.title}: ${err}`);
        }
    }
}

/**
 * Check if enrichment should stop and handle state cleanup if stopping.
 * Returns true if cycle should halt (either stopping or paused).
 */
async function shouldHaltCycle(): Promise<boolean> {
    if (isStopping || userStopped) {
        await enrichmentStateService.updateState({
            status: "idle",
            currentPhase: null,
        });
        isStopping = false;
        isPaused = false;
        return true;
    }
    return isPaused;
}

/**
 * Run a phase and return result. Returns null if cycle should halt.
 */
async function runPhase(
    phaseName: "artists" | "tracks" | "scan" | "podcasts",
    executor: () => Promise<number>,
): Promise<number | null> {
    await enrichmentStateService.updateState({
        status: "running",
        currentPhase: phaseName,
    });

    const result = await executor();

    if (await shouldHaltCycle()) {
        return null;
    }

    return result;
}

export async function executeArtistsPhase(): Promise<number> {
    // Reset temp-MBID artists that have been unresolvable for >24h
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.artist.updateMany({
        where: {
            mbid: { startsWith: "temp-" },
            enrichmentStatus: "unresolvable",
            lastEnriched: { lt: oneDayAgo },
        },
        data: { enrichmentStatus: "pending" },
    });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const pendingArtists = await prisma.artist.findMany({
        where: {
            OR: [
                { enrichmentStatus: "pending" },
                { enrichmentStatus: "failed" },
                { enrichmentStatus: "unresolvable", lastEnriched: { lt: sevenDaysAgo } },
            ],
            albums: { some: {} },
        },
        select: { id: true, name: true },
        take: ARTIST_BATCH_SIZE,
    });

    if (pendingArtists.length === 0) return 0;

    // Free reusable jobIds: completed immediately, failed after a backoff grace.
    // Without this a failed artist's `artist-<id>` marker blocks every re-add
    // until BullMQ's removeOnFail age (24h) expires -- far slower than intended.
    try {
        await artistQueue.clean(0, 0, "completed");
        await artistQueue.clean(FAILED_JOB_RETRY_GRACE_MS, 0, "failed");
    } catch (err) {
        logger.warn(`[Enrichment] artistQueue clean failed: ${(err as Error).message}`);
    }

    let queued = 0;
    for (const artist of pendingArtists) {
        try {
            // Only enqueue + park as "enriching" when the jobId slot is actually
            // free. A failed job younger than the grace still holds the slot, so
            // a plain add() would no-op while we parked the artist as
            // "enriching" anyway -- removing it from selection until a process
            // restart, never actually retrying. Skipping here leaves it
            // "failed"/"pending" so it backs off and retries once the grace
            // clean above frees the slot.
            const jobId = `artist-${artist.id}`;
            if (await artistQueue.getJob(jobId)) continue;
            // Add FIRST — if Redis is down, status stays "pending" and retries naturally
            await artistQueue.add(
                "enrich",
                { artistId: artist.id, artistName: artist.name },
                { jobId },
            );
            // Update AFTER successful add
            await prisma.artist.update({
                where: { id: artist.id },
                data: { enrichmentStatus: "enriching" },
            });
            queued++;
        } catch (err) {
            logger.warn(`[Enrichment] Failed to queue artist ${artist.id}: ${(err as Error).message}`);
        }
    }

    if (queued > 0) {
        logger.debug(`[Enrichment] Queued ${queued} artists`);
    }
    return queued;
}

export async function executeMoodTagsPhase(): Promise<number> {
    const tracks = await prisma.track.findMany({
        where: {
            OR: [
                { lastfmTags: { equals: [] } },
                { lastfmTags: { isEmpty: true } },
            ],
            // Exclude tracks already queued this cycle — prevents re-adding the
            // same tracks on every 5s tick before the worker can process them.
            // The worker always overwrites ["_queued"] with real data or a
            // terminal sentinel (["_no_mood_tags"], ["_not_found"]).
            NOT: { lastfmTags: { has: "_queued" } },
        },
        select: { id: true, title: true },
        take: TRACK_BATCH_SIZE,
        orderBy: [{ fileModified: "desc" }],
    });

    if (tracks.length === 0) return 0;

    // Free reusable jobIds: completed immediately, failed after a backoff grace.
    // The worker clears a failed track's tags to re-enable it, but the held
    // `track-<id>` marker silently defeats that re-pickup until cleaned.
    try {
        await trackQueue.clean(0, 0, "completed");
        await trackQueue.clean(FAILED_JOB_RETRY_GRACE_MS, 0, "failed");
    } catch (err) {
        logger.warn(`[Enrichment] trackQueue clean failed: ${(err as Error).message}`);
    }

    const queuedIds: string[] = [];
    for (const track of tracks) {
        try {
            // Only enqueue + mark "_queued" when the jobId slot is free. A failed
            // job younger than the grace still holds it, so a plain add() would
            // no-op while we marked the track in-flight anyway -- parking it out
            // of selection until restart instead of retrying. Skipping leaves it
            // selectable so it backs off and retries once the grace clean frees
            // the slot.
            const jobId = `track-${track.id}`;
            if (await trackQueue.getJob(jobId)) continue;
            await trackQueue.add(
                "enrich",
                { trackId: track.id, trackTitle: track.title },
                { jobId },
            );
            queuedIds.push(track.id);
        } catch (err) {
            logger.warn(`[Enrichment] Failed to queue track ${track.id}: ${(err as Error).message}`);
        }
    }

    if (queuedIds.length > 0) {
        // Mark as in-flight so the next orchestrator tick skips them
        await prisma.track.updateMany({
            where: { id: { in: queuedIds } },
            data: { lastfmTags: ["_queued"] },
        });
        logger.debug(`[Enrichment] Queued ${queuedIds.length} tracks`);
    }
    return queuedIds.length;
}

const SCAN_BATCH_SIZE = 100;

async function executeScanPhase(): Promise<number> {
    const musicPath = config.music.musicPath;
    if (!musicPath) return 0;

    const tracks = await prisma.track.findMany({
        where: {
            scanStatus: "pending",
            corrupt: false,
        },
        select: { id: true, filePath: true, title: true },
        take: SCAN_BATCH_SIZE,
        orderBy: { fileModified: "desc" },
    });

    if (tracks.length === 0) return 0;

    const { validateAudioHeader } = await import("../services/audioScanValidator");
    const redis = getRedis();
    let validated = 0;
    let invalid = 0;

    for (const track of tracks) {
        if (await shouldHaltCycle()) return validated;

        const fullPath = path.join(musicPath, track.filePath);
        const result = await validateAudioHeader(fullPath);

        if (result.valid) {
            await prisma.track.update({
                where: { id: track.id },
                data: { scanStatus: "validating" },
            });
            await redis.rpush(
                "audio:scan:queue",
                JSON.stringify({ trackId: track.id, filePath: track.filePath }),
            );
            validated++;
        } else {
            await prisma.track.update({
                where: { id: track.id },
                data: {
                    scanStatus: "invalid",
                    scanError: result.error ?? "Unknown validation failure",
                },
            });
            await enrichmentFailureService.recordFailure({
                entityType: "scan",
                entityId: track.id,
                entityName: track.title,
                errorMessage: result.error ?? "Unknown validation failure",
                errorCode: "SCAN_INVALID",
                metadata: { filePath: track.filePath },
            });
            invalid++;
        }
    }

    if (invalid > 0) {
        logger.info(`[Enrichment] Pre-scan: ${validated} valid, ${invalid} invalid`);
    }

    // Spot-check previously-valid tracks for file moves/deletes
    const RECHECK_BATCH = 20;
    const recheckTracks = await prisma.track.findMany({
        where: { scanStatus: "valid", analysisStatus: "pending" },
        select: { id: true, filePath: true },
        take: RECHECK_BATCH,
        orderBy: { updatedAt: "asc" },
    });

    for (const track of recheckTracks) {
        const recheckPath = path.join(musicPath, track.filePath);
        try {
            await fs.promises.access(recheckPath, fs.constants.R_OK);
        } catch {
            await prisma.track.update({
                where: { id: track.id },
                data: {
                    scanStatus: "invalid",
                    scanError: "File no longer accessible",
                },
            });
        }
    }

    return validated;
}



export async function executePodcastRefreshPhase(): Promise<number> {
    const podcastCount = await prisma.podcast.count();
    if (podcastCount === 0) return 0;

    const ONE_HOUR = 60 * 60 * 1000;
    const staleThreshold = new Date(Date.now() - ONE_HOUR);
    const stalePodcasts = await prisma.podcast.findMany({
        where: { lastRefreshed: { lt: staleThreshold } },
        select: { id: true, title: true },
    });

    if (stalePodcasts.length === 0) return 0;

    // BullMQ keeps the jobId dedup marker in Redis after a job settles -- for
    // BOTH completed and failed jobs. The original #81 fix cleaned only
    // "completed", which left failed jobs as permanent poison: one failed
    // refresh kept its `podcast-<id>` marker forever, so every later add() with
    // that jobId silently no-op'd and the podcast never refreshed again (a
    // single corrupt failed job took out all auto-refresh). Clean both states
    // so a failed refresh is retried rather than wedging the feed.
    try {
        await podcastQueue.clean(0, 0, "completed");
        await podcastQueue.clean(0, 0, "failed");
    } catch (err) {
        logger.warn(`[Enrichment] podcastQueue clean failed: ${(err as Error).message}`);
    }

    // Claim these podcasts by advancing lastRefreshed before queuing.
    // refreshPodcastFeed only advances lastRefreshed on success or a 304, so
    // without this an unreachable feed would keep matching the stale-window
    // query and be re-queued every cycle (seconds apart). Bumping up front
    // gives every outcome -- success, 304, or failure -- a full backoff window;
    // a successful refresh advances it again moments later.
    await prisma.podcast.updateMany({
        where: { id: { in: stalePodcasts.map((p) => p.id) } },
        data: { lastRefreshed: new Date() },
    });

    let queued = 0;
    for (const podcast of stalePodcasts) {
        try {
            await podcastQueue.add(
                "refresh",
                { podcastId: podcast.id, podcastTitle: podcast.title },
                { jobId: `podcast-${podcast.id}` }, // dedup -- safe now that completed jobs are cleaned above
            );
            queued++;
        } catch (err) {
            logger.warn(`[Enrichment] Failed to queue podcast ${podcast.id}: ${(err as Error).message}`);
        }
    }

    if (queued > 0) {
        logger.debug(`[Enrichment] Queued ${queued} podcast refreshes`);
    }
    return queued;
}

 /**
  * Get comprehensive enrichment progress
 *
 * Returns separate progress for:
 * - Artists & Track Tags: "Core" enrichment (must complete before app is fully usable)
 * - Audio Analysis: "Background" enrichment (runs in separate container, non-blocking)
 */
export async function getEnrichmentProgress() {
    // Artist progress
    const artistCounts = await prisma.artist.groupBy({
        by: ["enrichmentStatus"],
        _count: true,
    });

    const artistTotal = artistCounts.reduce((sum, s) => sum + s._count, 0);
    const artistCompleted =
        (artistCounts.find((s) => s.enrichmentStatus === "completed")?._count || 0) +
        (artistCounts.find((s) => s.enrichmentStatus === "unresolvable")?._count || 0);
    const artistPending =
        artistCounts.find((s) => s.enrichmentStatus === "pending")?._count || 0;

    // Exclude permanently_failed and corrupt tracks from enrichment totals --
    // these will never complete and should not drag down progress percentages
    const excludedCount = await prisma.track.count({
        where: {
            OR: [
                { analysisStatus: "permanently_failed" },
                { corrupt: true },
            ],
        },
    });
    const permanentlyFailedCount = await prisma.track.count({
        where: { analysisStatus: "permanently_failed" },
    });

    // Track tag progress (exclude unreachable tracks)
    const rawTrackTotal = await prisma.track.count();
    const trackTotal = rawTrackTotal - excludedCount;
    const trackTagsEnriched = await prisma.track.count({
        where: {
            AND: [
                { NOT: { lastfmTags: { equals: [] } } },
                { NOT: { lastfmTags: { equals: null } } },
                { analysisStatus: { not: "permanently_failed" } },
                { corrupt: false },
            ],
        },
    });

    // Core enrichment is complete when artists and track tags are done
    const coreComplete =
        artistPending === 0 && trackTotal - trackTagsEnriched === 0;

    return {
        // Core enrichment (blocking)
        artists: {
            total: artistTotal,
            completed: artistCompleted,
            pending: artistPending,
            failed:
                artistCounts.find((s) => s.enrichmentStatus === "failed")
                    ?._count || 0,
            progress:
                artistTotal > 0 ?
                    Math.round((artistCompleted / artistTotal) * 100)
                :   0,
        },
        trackTags: {
            total: trackTotal,
            enriched: trackTagsEnriched,
            pending: trackTotal - trackTagsEnriched,
            progress:
                trackTotal > 0 ?
                    Math.round((trackTagsEnriched / trackTotal) * 100)
                :   0,
        },

        // Overall status
        coreComplete,
        isFullyComplete: coreComplete,
    };
}

/**
 * Trigger an immediate enrichment cycle (non-blocking)
 * Used when new tracks are added and we want to collect mood tags right away
 * instead of waiting for the 30s background interval
 */
export async function triggerEnrichmentNow(): Promise<{
    artists: number;
    tracks: number;
}> {
    logger.debug("[Enrichment] Triggering immediate enrichment cycle...");

    await clearPauseState();

    // Set flag to bypass the minimum interval check (does NOT bypass isRunning —
    // a concurrent cycle will still cause this call to return an empty result)
    immediateEnrichmentRequested = true;

    return runEnrichmentCycle(false);
}

 /**
  * Re-run artist enrichment only (from the beginning)
  * Resets artist statuses and starts sequential enrichment from Phase 1
  */
 export async function reRunArtistsOnly(): Promise<{ count: number }> {
     logger.debug("[Enrichment] Re-running artist enrichment only...");

     const result = await resetArtistsOnly();

     logger.debug("[Enrichment] Starting sequential enrichment from artists phase...");
     await clearPauseState();
     immediateEnrichmentRequested = true;

     // Run full cycle but it will stop after artists phase if paused/stopped
     await runEnrichmentCycle(false);

     return { count: result.count };
 }

 /**
  * Re-run mood tags only (from the beginning)
  * Resets mood tags and starts sequential enrichment from Phase 1
  */
 export async function reRunMoodTagsOnly(): Promise<{ count: number }> {
     logger.debug("[Enrichment] Re-running mood tags only...");

     const result = await resetMoodTagsOnly();

     logger.debug("[Enrichment] Starting sequential enrichment from mood tags phase...");
     await clearPauseState();
     immediateEnrichmentRequested = true;

     await runEnrichmentCycle(false);

return { count: result.count };
  }

export async function resetAllEnrichmentData(): Promise<{
    tracksReset: number;
    artistsReset: number;
    failuresDeleted: number;
    moodBucketsDeleted: number;
}> {
    const redisInstance = getRedis();

    isStopping = false;
    isPaused = false;
    userStopped = true;
    userStoppedWarned = false;

    try {
        await enrichmentStateService.stop();
    } catch {
        // May throw if no active enrichment state exists
    }

    const tracksReset = await prisma.track.updateMany({
        data: {
            scanStatus: "pending",
            scanError: null,
            moodHappy: null,
            moodSad: null,
            moodRelaxed: null,
            moodAggressive: null,
            moodParty: null,
            moodAcoustic: null,
            moodElectronic: null,
            moodTags: [],
            lastfmTags: [],
        },
    });

    const artistsReset = await prisma.artist.updateMany({
        data: {
            enrichmentStatus: "pending",
            lastEnriched: null,
            summary: null,
            heroUrl: null,
            genres: Prisma.DbNull,
            similarArtistsJson: Prisma.DbNull,
        },
    });
    await prisma.similarArtist.deleteMany({});

    const moodBucketsDeleted = await prisma.moodBucket.deleteMany({});

    const failuresDeleted = await prisma.enrichmentFailure.deleteMany({});

    const keysToDelete = ["enrichment:state"];
    if (keysToDelete.length > 0) {
        await redisInstance.del(...keysToDelete);
    }

    for (const queue of [artistQueue, trackQueue, vibeQueue, podcastQueue]) {
        try {
            await queue.clean(0, 0, "completed");
            await queue.clean(0, 0, "failed");
            await queue.clean(0, 0, "wait");
            await queue.clean(0, 0, "delayed");
            await queue.clean(0, 0, "active");
        } catch {
            // Queue may not exist yet
        }
    }

    logger.info(`[Enrichment] Full reset: ${tracksReset.count} tracks, ${artistsReset.count} artists, ${failuresDeleted.count} failures cleared`);

    return {
        tracksReset: tracksReset.count,
        artistsReset: artistsReset.count,
        failuresDeleted: failuresDeleted.count,
        moodBucketsDeleted: moodBucketsDeleted.count,
    };
}
