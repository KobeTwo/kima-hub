/**
 * Discovery Seeding Module
 *
 * Handles seed artist selection for discovering new music based on:
 * - Library contents (random sample of album artists)
 * - Album ownership checking across multiple sources
 */

import { prisma } from '../../utils/db';
import { logger } from '../../utils/logger';
import { lidarrService } from '../lidarr';
import { subWeeks } from 'date-fns';
import { normalizeForMatching, matchAlbum } from '../../utils/fuzzyMatch';

export interface SeedArtist {
    name: string;
    mbid?: string;
}

export class DiscoverySeeding {
    private readonly DEFAULT_SEED_COUNT = 10;
    // Sample size for the random library selection (keeps the query cheap)
    private readonly LIBRARY_SAMPLE_SIZE = 100;

    /**
     * Gets seed artists from the user's library.
     * Play history is no longer available, so seeds are a random sample of
     * library album artists (metadata signal instead of recent plays).
     */
    async getSeedArtists(_userId: string, seedCount?: number): Promise<SeedArtist[]> {
        const limit = seedCount ?? this.DEFAULT_SEED_COUNT;

        const albums = await prisma.album.findMany({
            where: { location: 'LIBRARY' },
            select: {
                artist: { select: { id: true, name: true, mbid: true } },
            },
            take: this.LIBRARY_SAMPLE_SIZE,
        });

        const artistMap = new Map<string, SeedArtist>();
        for (const album of albums) {
            const artist = album.artist;
            if (artist && this.isValidMbid(artist.mbid) && !artistMap.has(artist.id)) {
                artistMap.set(artist.id, {
                    name: artist.name,
                    mbid: artist.mbid,
                });
            }
        }

        const artists = Array.from(artistMap.values());
        // Random sample (Fisher-Yates) -- no play history left to rank by
        for (let i = artists.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [artists[i], artists[j]] = [artists[j], artists[i]];
        }

        const selected = artists.slice(0, limit);
        logger.debug(`[DiscoverySeeding] Selected ${selected.length} random library seed artists`);
        return selected;
    }

    /**
     * Checks if an artist is already in the user's library (has albums).
     * Discovery should find NEW artists, not more albums from artists they already own.
     */
    async isArtistInLibrary(artistMbid: string): Promise<boolean> {
        if (!this.isValidMbid(artistMbid)) {
            return false;
        }

        const artist = await prisma.artist.findFirst({
            where: { mbid: artistMbid },
            include: { albums: { take: 1 } },
        });

        if (artist && artist.albums.length > 0) {
            logger.debug(`[DiscoverySeeding] Artist ${artistMbid} is in library`);
            return true;
        }

        return false;
    }

    /**
     * Checks if an album is already owned through any source:
     * - OwnedAlbum table
     * - Album table
     * - Previous discovery
     * - Pending downloads
     * - Lidarr
     * - Fuzzy name matching (if artistName and albumTitle provided)
     */
    async isAlbumOwned(
        albumMbid: string,
        userId: string,
        artistName?: string,
        albumTitle?: string
    ): Promise<boolean> {
        // Exact MBID checks
        const ownedAlbum = await prisma.ownedAlbum.findFirst({
            where: { rgMbid: albumMbid },
        });
        if (ownedAlbum) return true;

        const existingAlbum = await prisma.album.findFirst({
            where: { rgMbid: albumMbid },
        });
        if (existingAlbum) return true;

        const previousDiscovery = await prisma.discoveryAlbum.findFirst({
            where: { rgMbid: albumMbid, userId },
        });
        if (previousDiscovery) return true;

        const pendingDownload = await prisma.downloadJob.findFirst({
            where: {
                targetMbid: albumMbid,
                status: { in: ['pending', 'processing'] },
            },
        });
        if (pendingDownload) return true;

        const inLidarr = await lidarrService.isAlbumAvailable(albumMbid);
        if (inLidarr) return true;

        // Check exclusion window (recently discovered albums)
        const excluded = await this.isAlbumExcluded(albumMbid, userId);
        if (excluded) return true;

        // Check if recently unavailable (failed downloads)
        const unavailable = await this.isAlbumUnavailable(albumMbid, userId);
        if (unavailable) return true;

        // OPTIMIZED fuzzy matching - only if names provided
        if (artistName && albumTitle) {
            const normArtist = normalizeForMatching(artistName);
            const artistFirstWord = normArtist.split(' ')[0];

            // Allow 2+ character names (handles U2, AC/DC, M83, etc.)
            if (artistFirstWord && artistFirstWord.length >= 2) {
                const candidates = await prisma.album.findMany({
                    where: {
                        location: 'LIBRARY',
                        artist: {
                            name: {
                                startsWith: artistFirstWord,  // More precise than contains
                                mode: 'insensitive',
                            },
                        },
                    },
                    include: {
                        artist: true,
                    },
                    take: 50,  // Increased to catch more potential matches
                });

                for (const album of candidates) {
                    if (matchAlbum(artistName, albumTitle, album.artist.name, album.title)) {
                        logger.debug(`[DiscoverySeeding] Fuzzy match: ${artistName} - ${albumTitle} = ${album.artist.name} - ${album.title}`);
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * Check if album was recently recommended (exclusion window).
     * Prevents re-recommending albums from last 12 weeks.
     */
    async isAlbumExcluded(albumMbid: string, userId: string): Promise<boolean> {
        const EXCLUSION_WEEKS = 12;
        const exclusionCutoff = subWeeks(new Date(), EXCLUSION_WEEKS);

        const recentDiscovery = await prisma.discoveryAlbum.findFirst({
            where: {
                rgMbid: albumMbid,
                userId,
                weekStartDate: { gte: exclusionCutoff },
            },
        });

        if (recentDiscovery) {
            logger.debug(`[DiscoverySeeding] Album ${albumMbid} excluded - discovered within last ${EXCLUSION_WEEKS} weeks`);
            return true;
        }

        return false;
    }

    /**
     * Check if album failed to download in recent weeks.
     * Prevents wasting slots on albums not available on Soulseek.
     */
    async isAlbumUnavailable(albumMbid: string, userId: string): Promise<boolean> {
        const UNAVAILABLE_RETRY_WEEKS = 4;
        const retryCutoff = subWeeks(new Date(), UNAVAILABLE_RETRY_WEEKS);

        const recentFailure = await prisma.unavailableAlbum.findFirst({
            where: {
                albumMbid,
                userId,
                weekStartDate: { gte: retryCutoff },
            },
        });

        if (recentFailure) {
            logger.debug(`[DiscoverySeeding] Album ${albumMbid} unavailable - failed within last ${UNAVAILABLE_RETRY_WEEKS} weeks`);
            return true;
        }

        return false;
    }

    /**
     * Validates that an MBID is not null/undefined and not a temporary ID.
     */
    private isValidMbid(mbid: string | null | undefined): mbid is string {
        return !!mbid && !mbid.startsWith('temp-');
    }
}

export const discoverySeeding = new DiscoverySeeding();
