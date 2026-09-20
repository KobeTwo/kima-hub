import { Router } from "express";
import { prisma } from "../../utils/db";
import { logger } from "../../utils/logger";
import { lrclibService } from "../../services/lrclib";
import { rateLimiter } from "../../services/rateLimiter";
import { getMergedGenres } from "../../utils/metadataOverrides";
import {
  getEffectiveYear,
  getDecadeWhereClause,
  getDecadeFromYear,
} from "../../utils/dateFilters";
import { shuffleArray } from "../../utils/shuffle";
import { config } from "../../config";
import path from "path";
import fs from "fs";

const TRACK_SORT_MAP: Record<string, any> = {
  name: { title: "asc" as const },
  "name-desc": { title: "desc" as const },
};

const MAX_LIMIT = 10000;

const router = Router();

router.get("/recently-added", async (req, res) => {
  try {
    const { limit = "10" } = req.query;
    const limitNum = parseInt(limit as string, 10);

    const recentAlbums = await prisma.album.findMany({
      where: {
        location: "LIBRARY",
        tracks: { some: {} },
      },
      orderBy: { lastSynced: "desc" },
      take: 20,
      include: {
        artist: {
          select: {
            id: true,
            mbid: true,
            name: true,
            heroUrl: true,
            userHeroUrl: true,
          },
        },
      },
    });

    const artistsMap = new Map();
    for (const album of recentAlbums) {
      if (!artistsMap.has(album.artist.id)) {
        artistsMap.set(album.artist.id, album.artist);
      }
      if (artistsMap.size >= limitNum) break;
    }

    const artistIds = Array.from(artistsMap.keys());
    const albumCounts = await prisma.album.groupBy({
      by: ["artistId"],
      where: {
        artistId: { in: artistIds },
        location: "LIBRARY",
        tracks: { some: {} },
      },
      _count: { id: true },
    });
    const albumCountMap = new Map(
      albumCounts.map((ac) => [ac.artistId, ac._count.id]),
    );

    const artistsWithImages = Array.from(artistsMap.values()).map((artist) => {
      const coverArt = artist.userHeroUrl ?? artist.heroUrl ?? null;
      return {
        ...artist,
        coverArt,
        albumCount: albumCountMap.get(artist.id) || 0,
      };
    });

    res.json({ artists: artistsWithImages });
  } catch (error) {
    logger.error("Get recently added error:", error);
    res.status(500).json({ error: "Failed to fetch recently added" });
  }
});

router.get("/tracks", async (req, res) => {
  try {
    const {
      albumId,
      limit: limitParam = "100",
      offset: offsetParam = "0",
      sortBy = "name",
    } = req.query;
    const limit = Math.min(
      parseInt(limitParam as string, 10) || 100,
      MAX_LIMIT,
    );
    const offset = parseInt(offsetParam as string, 10) || 0;

    let orderBy: any;
    if (albumId) {
      orderBy = { trackNo: "asc" as const };
    } else {
      orderBy = TRACK_SORT_MAP[sortBy as string] ?? { title: "asc" as const };
    }

    const where: any = {};
    if (albumId) {
      where.albumId = albumId as string;
    }

    const [tracksData, total] = await Promise.all([
      prisma.track.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy,
        include: {
          album: {
            include: {
              artist: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      }),
      prisma.track.count({ where }),
    ]);

    const tracks = tracksData.map((track) => ({
      ...track,
      album: {
        ...track.album,
        coverArt: track.album.coverUrl,
      },
    }));

    res.json({ tracks, total, offset, limit });
  } catch (error) {
    logger.error("Get tracks error:", error);
    res.status(500).json({ error: "Failed to fetch tracks" });
  }
});

router.get("/tracks/shuffle", async (req, res) => {
  try {
    const { limit: limitParam = "100" } = req.query;
    const limit = Math.min(
      parseInt(limitParam as string, 10) || 100,
      MAX_LIMIT,
    );

    const totalTracks = await prisma.track.count();

    if (totalTracks === 0) {
      return res.json({ tracks: [], total: 0 });
    }

    let tracksData;
    if (totalTracks <= limit) {
      tracksData = await prisma.track.findMany({
        include: {
          album: {
            include: {
              artist: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });
      tracksData = shuffleArray(tracksData);
    } else {
      const randomIds = await prisma.$queryRaw<{ id: string }[]>`
                SELECT id FROM "Track"
                ORDER BY RANDOM()
                LIMIT ${limit}
            `;

      tracksData = await prisma.track.findMany({
        where: {
          id: { in: randomIds.map((r) => r.id) },
        },
        include: {
          album: {
            include: {
              artist: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      for (let i = tracksData.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tracksData[i], tracksData[j]] = [tracksData[j], tracksData[i]];
      }
    }

    const tracks = tracksData.slice(0, limit).map((track) => ({
      ...track,
      album: {
        ...track.album,
        coverArt: track.album.coverUrl,
      },
    }));

    res.json({ tracks, total: totalTracks });
  } catch (error) {
    logger.error("Shuffle tracks error:", error);
    res.status(500).json({ error: "Failed to shuffle tracks" });
  }
});

router.get("/tracks/:id/lyrics", async (req, res) => {
  try {
    const existing = await prisma.trackLyrics.findUnique({
      where: { track_id: req.params.id },
    });

    if (existing && existing.source !== "none") {
      return res.json({
        plainLyrics: existing.plain_lyrics,
        syncedLyrics: existing.synced_lyrics,
        source: existing.source,
      });
    }

    if (existing && existing.source === "none") {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      if (existing.fetched_at > thirtyDaysAgo) {
        return res.json({
          plainLyrics: null,
          syncedLyrics: null,
          source: "none",
        });
      }
    }

    const track = await prisma.track.findUnique({
      where: { id: req.params.id },
      include: {
        album: {
          include: {
            artist: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!track) {
      return res.status(404).json({ error: "Track not found" });
    }

    const artistName = track.album?.artist?.name || "";
    const albumName = track.album?.title || "";
    const durationSecs = track.duration || 0;

    try {
      const result = await rateLimiter.execute("lrclib", () =>
        lrclibService.fetchLyrics(
          track.title,
          artistName,
          albumName,
          durationSecs
        )
      );

      if (result) {
        await prisma.trackLyrics.upsert({
          where: { track_id: track.id },
          create: {
            track_id: track.id,
            plain_lyrics: result.plainLyrics,
            synced_lyrics: result.syncedLyrics,
            source: "lrclib",
            lrclib_id: result.id,
          },
          update: {
            plain_lyrics: result.plainLyrics,
            synced_lyrics: result.syncedLyrics,
            source: "lrclib",
            lrclib_id: result.id,
            fetched_at: new Date(),
          },
        });

        return res.json({
          plainLyrics: result.plainLyrics,
          syncedLyrics: result.syncedLyrics,
          source: "lrclib",
        });
      }

      await prisma.trackLyrics.upsert({
        where: { track_id: track.id },
        create: {
          track_id: track.id,
          source: "none",
        },
        update: {
          source: "none",
          fetched_at: new Date(),
        },
      });

      return res.json({
        plainLyrics: null,
        syncedLyrics: null,
        source: "none",
      });
    } catch (fetchError) {
      logger.error("[LYRICS] LRCLIB fetch failed:", fetchError);
      return res.json({
        plainLyrics: existing?.plain_lyrics || null,
        syncedLyrics: existing?.synced_lyrics || null,
        source: existing?.source || "none",
      });
    }
  } catch (error) {
    logger.error("Get lyrics error:", error);
    res.status(500).json({ error: "Failed to fetch lyrics" });
  }
});

router.get("/tracks/:id", async (req, res) => {
  try {
    const track = await prisma.track.findUnique({
      where: { id: req.params.id },
      include: {
        album: {
          include: {
            artist: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!track) {
      return res.status(404).json({ error: "Track not found" });
    }

    const formattedTrack = {
      id: track.id,
      title: track.title,
      artist: {
        name: track.album?.artist?.name || "Unknown Artist",
        id: track.album?.artist?.id,
      },
      album: {
        title: track.album?.title || "Unknown Album",
        coverArt: track.album?.coverUrl,
        id: track.album?.id,
      },
      duration: track.duration,
    };

    res.json(formattedTrack);
  } catch (error) {
    logger.error("Get track error:", error);
    res.status(500).json({ error: "Failed to fetch track" });
  }
});

router.delete("/tracks/:id", async (req, res) => {
  try {
    const track = await prisma.track.findUnique({
      where: { id: req.params.id },
      include: {
        album: {
          include: {
            artist: true,
          },
        },
      },
    });

    if (!track) {
      return res.status(404).json({ error: "Track not found" });
    }

    if (track.filePath) {
      try {
        const absolutePath = path.join(config.music.musicPath, track.filePath);

        if (fs.existsSync(absolutePath)) {
          fs.unlinkSync(absolutePath);
          logger.debug(`[DELETE] Deleted file: ${absolutePath}`);
        }
      } catch (err) {
        logger.warn("[DELETE] Could not delete file:", err);
      }
    }

    await prisma.track.delete({
      where: { id: track.id },
    });

    logger.debug(`[DELETE] Deleted track: ${track.title}`);

    res.json({ message: "Track deleted successfully" });
  } catch (error) {
    logger.error("Delete track error:", error);
    res.status(500).json({ error: "Failed to delete track" });
  }
});

router.get("/genres", async (_req, res) => {
  try {
    const artists = await prisma.artist.findMany({
      select: { name: true, normalizedName: true },
    });
    const artistNames = new Set(
      artists.flatMap((a) =>
        [a.name.toLowerCase(), a.normalizedName?.toLowerCase()].filter(Boolean),
      ),
    );

    const minTracks = 15;
    const genreResults = await prisma.$queryRaw<
      { genre: string; track_count: bigint }[]
    >`
            SELECT LOWER(g.genre) as genre, COUNT(DISTINCT t.id) as track_count
            FROM "Artist" ar
            CROSS JOIN LATERAL jsonb_array_elements_text(ar.genres::jsonb) AS g(genre)
            JOIN "Album" a ON a."artistId" = ar.id
            JOIN "Track" t ON t."albumId" = a.id
            WHERE ar.genres IS NOT NULL
            GROUP BY LOWER(g.genre)
            HAVING COUNT(DISTINCT t.id) >= ${minTracks}
            ORDER BY track_count DESC
            LIMIT 20
        `;

    const genres = genreResults
      .map((row) => ({
        genre: row.genre,
        count: Number(row.track_count),
      }))
      .filter((g) => !artistNames.has(g.genre.toLowerCase()));

    logger.debug(
      `[Genres] Found ${genres.length} genres from Artist.genres (min ${minTracks} tracks)`,
    );

    res.json({ genres });
  } catch (error) {
    logger.error("Genres endpoint error:", error);
    res.status(500).json({ error: "Failed to get genres" });
  }
});

router.get("/decades", async (_req, res) => {
  try {
    const albums = await prisma.album.findMany({
      select: {
        year: true,
        originalYear: true,
        displayYear: true,
        _count: { select: { tracks: true } },
      },
    });

    const decadeMap = new Map<number, number>();

    for (const album of albums) {
      const effectiveYear = getEffectiveYear(album);
      if (effectiveYear) {
        const decadeStart = getDecadeFromYear(effectiveYear);
        decadeMap.set(
          decadeStart,
          (decadeMap.get(decadeStart) || 0) + album._count.tracks,
        );
      }
    }

    const decades = Array.from(decadeMap.entries())
      .map(([decade, count]) => ({ decade, count }))
      .filter((d) => d.count >= 15)
      .sort((a, b) => b.decade - a.decade);

    res.json({ decades });
  } catch (error) {
    logger.error("Decades endpoint error:", error);
    res.status(500).json({ error: "Failed to get decades" });
  }
});

export default router;
