import { prisma } from "../../utils/db";
import { logger } from "../../utils/logger";
import { normalizeArtistName } from "../../utils/artistNormalization";
import { lastFmService } from "../lastfm";
import {
    ProgrammaticMix,
    getMixColor,
    randomSample,
    getSeededRandom,
} from "./helpers";

const TRACK_LIMIT = 20;

export async function generateTopTracksMix(
    _userId: string
): Promise<ProgrammaticMix | null> {
    // No play history: "top" tracks come from the most recently synced
    // library albums (metadata signal replacing play counts)
    const recentAlbums = await prisma.album.findMany({
        where: { location: "LIBRARY" },
        orderBy: { lastSynced: "desc" },
        take: 50,
        select: { id: true },
    });

    if (recentAlbums.length === 0) {
        logger.debug(`[TOP TRACKS MIX] FAILED: No library albums found`);
        return null;
    }

    const tracks = await prisma.track.findMany({
        where: { albumId: { in: recentAlbums.map((a) => a.id) } },
        include: {
            album: { select: { coverUrl: true } },
        },
    });

    logger.debug(
        `[TOP TRACKS MIX] Found ${tracks.length} tracks from recent albums`
    );
    if (tracks.length < 5) {
        logger.debug(
            `[TOP TRACKS MIX] FAILED: Only ${tracks.length} tracks (need at least 5)`
        );
        return null;
    }

    // Keep a deterministic recency order (most recently synced album first)
    const albumOrder = new Map(recentAlbums.map((a, i) => [a.id, i]));
    const orderedTracks = [...tracks]
        .sort(
            (a, b) =>
                (albumOrder.get(a.albumId) ?? 0) -
                (albumOrder.get(b.albumId) ?? 0)
        )
        .slice(0, TRACK_LIMIT);

    const coverUrls = orderedTracks
        .filter((t) => t.album.coverUrl)
        .slice(0, 4)
        .map((t) => t.album.coverUrl!);

    return {
        id: "top-tracks",
        type: "top-tracks",
        name: "Your Top 20",
        description: "Highlights from your most recent albums",
        trackIds: orderedTracks.map((t) => t.id),
        coverUrls,
        trackCount: orderedTracks.length,
        color: getMixColor("top-tracks"),
    };
}

export async function generateRediscoverMix(
    _userId: string,
    today: string
): Promise<ProgrammaticMix | null> {
    // No play history: the "underplayed" filter is gone, so sample directly
    // from the library catalog
    const allTracks = await prisma.track.findMany({
        where: {
            album: { location: "LIBRARY" },
        },
        take: 5000,
        include: {
            album: { select: { coverUrl: true } },
        },
    });

    if (allTracks.length < 5) return null;

    const seed = getSeededRandom(`rediscover-${today}`);
    let random = seed;
    const shuffled = allTracks.sort(() => {
        random = (random * 9301 + 49297) % 233280;
        return random / 233280 - 0.5;
    });

    const selectedTracks = shuffled.slice(0, TRACK_LIMIT);
    const coverUrls = selectedTracks
        .filter((t) => t.album.coverUrl)
        .slice(0, 4)
        .map((t) => t.album.coverUrl!);

    return {
        id: `rediscover-${today}`,
        type: "rediscover",
        name: "Rediscover",
        description: "Hidden gems you rarely play",
        trackIds: selectedTracks.map((t) => t.id),
        coverUrls,
        trackCount: selectedTracks.length,
        color: getMixColor("rediscover"),
    };
}

export async function generateArtistSimilarMix(
    _userId: string
): Promise<ProgrammaticMix | null> {
    // No play history: anchor on the artist with the most albums in the library.
    const topArtistRows = await prisma.album.groupBy({
        by: ["artistId"],
        where: { location: "LIBRARY" },
        _count: true,
        orderBy: { _count: { artistId: "desc" } },
        take: 1,
    });

    const topArtistId = topArtistRows[0]?.artistId;
    if (!topArtistId) {
        logger.debug(`[ARTIST SIMILAR MIX] FAILED: No library albums found`);
        return null;
    }

    const topArtist = await prisma.artist.findUnique({
        where: { id: topArtistId },
    });

    if (!topArtist || !topArtist.name) {
        logger.debug(
            `[ARTIST SIMILAR MIX] FAILED: Top artist not found or has no name`
        );
        return null;
    }

    logger.debug(`[ARTIST SIMILAR MIX] Top artist: ${topArtist.name}`);

    try {
        const similarArtists = await lastFmService.getSimilarArtists(
            topArtist.mbid || "",
            topArtist.name,
            10
        );

        logger.debug(
            `[ARTIST SIMILAR MIX] Last.fm returned ${similarArtists.length} similar artists`
        );

        const similarArtistNormalized = similarArtists.map((a) =>
            normalizeArtistName(a.name)
        );
        const artistsInLibrary = await prisma.artist.findMany({
            where: { normalizedName: { in: similarArtistNormalized } },
            include: {
                albums: {
                    include: {
                        tracks: {
                            include: {
                                album: { select: { coverUrl: true } },
                            },
                        },
                    },
                },
            },
        });

        logger.debug(
            `[ARTIST SIMILAR MIX] Found ${artistsInLibrary.length} similar artists in library`
        );

        const tracks = artistsInLibrary.flatMap((artist) =>
            artist.albums.flatMap((album) => album.tracks)
        );

        logger.debug(
            `[ARTIST SIMILAR MIX] Total tracks from similar artists: ${tracks.length}`
        );

        if (tracks.length < 5) {
            logger.debug(
                `[ARTIST SIMILAR MIX] FAILED: Only ${tracks.length} tracks (need at least 5)`
            );
            return null;
        }

        const selectedTracks = randomSample(tracks, TRACK_LIMIT);
        const coverUrls = selectedTracks
            .filter((t) => t.album.coverUrl)
            .slice(0, 4)
            .map((t) => t.album.coverUrl!);

        return {
            id: `artist-similar-${topArtistId}`,
            type: "artist-similar",
            name: `More Like ${topArtist.name}`,
            description: `Similar artists you might enjoy`,
            trackIds: selectedTracks.map((t) => t.id),
            coverUrls,
            trackCount: selectedTracks.length,
            color: getMixColor("artist-similar"),
        };
    } catch (error) {
        logger.error("Failed to generate artist similar mix:", error);
        return null;
    }
}

export async function generateRandomDiscoveryMix(
    _userId: string,
    today: string
): Promise<ProgrammaticMix | null> {
    const totalAlbums = await prisma.album.count({
        where: { tracks: { some: {} } },
    });

    if (totalAlbums < 10) return null;

    const seed = getSeededRandom(`random-${today}`) % totalAlbums;

    const randomAlbums = await prisma.album.findMany({
        where: { tracks: { some: {} } },
        include: {
            tracks: {
                include: {
                    album: { select: { coverUrl: true } },
                },
            },
        },
        skip: seed,
        take: 5,
    });

    const tracks = randomAlbums.flatMap((album) => album.tracks);
    if (tracks.length < 5) return null;

    const selectedTracks = randomSample(tracks, TRACK_LIMIT);
    const coverUrls = randomAlbums
        .filter((a) => a.coverUrl)
        .slice(0, 4)
        .map((a) => a.coverUrl!);

    return {
        id: `random-discovery-${today}`,
        type: "discovery",
        name: "Random Discovery",
        description: "Random albums to explore today",
        trackIds: selectedTracks.map((t) => t.id),
        coverUrls,
        trackCount: selectedTracks.length,
        color: getMixColor("discovery"),
    };
}
