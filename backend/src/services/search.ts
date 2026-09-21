import { prisma } from "../utils/db";
import { logger } from "../utils/logger";
import { redisClient } from "../utils/redis";

export function normalizeCacheQuery(query: string): string {
    return query.trim().toLowerCase().replace(/\s+/g, " ");
}

interface SearchOptions {
    query: string;
    limit?: number;
    offset?: number;
}

export interface ArtistSearchResult {
    id: string;
    name: string;
    mbid: string;
    heroUrl: string | null;
    summary?: string;
    rank: number;
}

export interface AlbumSearchResult {
    id: string;
    title: string;
    artistId: string;
    artistName: string;
    year: number | null;
    coverUrl: string | null;
    rank: number;
}

export interface TrackSearchResult {
    id: string;
    title: string;
    albumId: string;
    albumTitle: string;
    artistId: string;
    artistName: string;
    duration: number;
    rank: number;
}

export interface SearchByTypeOptions {
    query: string;
    type: string;
    limit?: number;
    offset?: number;
    genre?: string;
}

export interface SearchResults {
    artists: ArtistSearchResult[];
    albums: AlbumSearchResult[];
    tracks: TrackSearchResult[];
}

export class SearchService {
    /**
     * Convert user query to PostgreSQL tsquery format
     * Splits on whitespace and adds prefix matching (:*)
     * Example: "radio head" -> "radio:* & head:*"
     */
    private queryToTsquery(query: string): string {
        const terms = query
            .trim()
            .replace(/\s*&\s*/g, " and ")
            .split(/\s+/)
            .map((term) => term.replace(/[^\w]/g, ""))
            .filter((term) => term.length > 0);

        if (terms.length === 0) return "";

        return terms.map((term) => `${term}:*`).join(" & ");
    }

    private async searchArtistsFallback({
        query,
        limit = 20,
        offset = 0,
    }: SearchOptions): Promise<ArtistSearchResult[]> {
        const results = await prisma.artist.findMany({
            where: {
                name: {
                    contains: query,
                    mode: "insensitive",
                },
                albums: {
                    some: {},
                },
            },
            select: {
                id: true,
                name: true,
                mbid: true,
                heroUrl: true,
            },
            take: limit,
            skip: offset,
            orderBy: {
                name: "asc",
            },
        });

        return results.map((r) => ({ ...r, rank: 0 }));
    }

    async searchArtists({
        query,
        limit = 20,
        offset = 0,
    }: SearchOptions): Promise<ArtistSearchResult[]> {
        if (!query || query.trim().length === 0) {
            return [];
        }

        const tsquery = this.queryToTsquery(query);
        if (!tsquery) {
            return this.searchArtistsFallback({ query, limit, offset });
        }

        try {
            const results = await prisma.$queryRaw<ArtistSearchResult[]>`
        SELECT
          a.id,
          a.name,
          a.mbid,
          a."heroUrl",
          a.summary,
          ts_rank(a."searchVector", to_tsquery('english', ${tsquery})) AS rank
        FROM "Artist" a
        WHERE a."searchVector" @@ to_tsquery('english', ${tsquery})
          AND EXISTS (SELECT 1 FROM "Album" alb WHERE alb."artistId" = a.id)
        ORDER BY rank DESC, a.name ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

            return results.length > 0 ? results : this.searchArtistsFallback({ query, limit, offset });
        } catch (error) {
            logger.error("Artist search error:", error);
            return this.searchArtistsFallback({ query, limit, offset });
        }
    }

    private async searchAlbumsFallback({
        query,
        limit = 20,
        offset = 0,
    }: SearchOptions): Promise<AlbumSearchResult[]> {
        const results = await prisma.album.findMany({
            where: {
                OR: [
                    {
                        title: {
                            contains: query,
                            mode: "insensitive",
                        },
                    },
                    {
                        artist: {
                            name: {
                                contains: query,
                                mode: "insensitive",
                            },
                        },
                    },
                ],
            },
            select: {
                id: true,
                title: true,
                artistId: true,
                year: true,
                coverUrl: true,
                artist: {
                    select: {
                        name: true,
                    },
                },
            },
            take: limit,
            skip: offset,
            orderBy: {
                title: "asc",
            },
        });

        return results.map((r) => ({
            id: r.id,
            title: r.title,
            artistId: r.artistId,
            artistName: r.artist.name,
            year: r.year,
            coverUrl: r.coverUrl,
            rank: 0,
        }));
    }

    async searchAlbums({
        query,
        limit = 20,
        offset = 0,
    }: SearchOptions): Promise<AlbumSearchResult[]> {
        if (!query || query.trim().length === 0) {
            return [];
        }

        const tsquery = this.queryToTsquery(query);
        if (!tsquery) {
            return this.searchAlbumsFallback({ query, limit, offset });
        }

        try {
            const results = await prisma.$queryRaw<AlbumSearchResult[]>`
        SELECT * FROM (
          SELECT DISTINCT ON (id) id, title, "artistId", "artistName", year, "coverUrl", rank
          FROM (
            SELECT
              a.id,
              a.title,
              a."artistId",
              ar.name as "artistName",
              a.year,
              a."coverUrl",
              ts_rank(a."searchVector", to_tsquery('english', ${tsquery})) AS rank
            FROM "Album" a
            LEFT JOIN "Artist" ar ON a."artistId" = ar.id
            WHERE a."searchVector" @@ to_tsquery('english', ${tsquery})

            UNION ALL

            SELECT
              a.id,
              a.title,
              a."artistId",
              ar.name as "artistName",
              a.year,
              a."coverUrl",
              ts_rank(ar."searchVector", to_tsquery('english', ${tsquery})) AS rank
            FROM "Album" a
            INNER JOIN "Artist" ar ON a."artistId" = ar.id
            WHERE ar."searchVector" @@ to_tsquery('english', ${tsquery})
          ) combined
          ORDER BY id, rank DESC
        ) deduped
        ORDER BY rank DESC, title ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

            return results.length > 0 ? results : this.searchAlbumsFallback({ query, limit, offset });
        } catch (error) {
            logger.error("Album search error:", error);
            return this.searchAlbumsFallback({ query, limit, offset });
        }
    }

    private async searchTracksFallback({
        query,
        limit = 20,
        offset = 0,
    }: SearchOptions): Promise<TrackSearchResult[]> {
        const results = await prisma.track.findMany({
            where: {
                title: {
                    contains: query,
                    mode: "insensitive",
                },
            },
            select: {
                id: true,
                title: true,
                albumId: true,
                duration: true,
                album: {
                    select: {
                        title: true,
                        artistId: true,
                        artist: {
                            select: {
                                name: true,
                            },
                        },
                    },
                },
            },
            take: limit,
            skip: offset,
            orderBy: {
                title: "asc",
            },
        });

        return results.map((r) => ({
            id: r.id,
            title: r.title,
            albumId: r.albumId,
            albumTitle: r.album.title,
            artistId: r.album.artistId,
            artistName: r.album.artist.name,
            duration: r.duration,
            rank: 0,
        }));
    }

    async searchTracks({
        query,
        limit = 20,
        offset = 0,
    }: SearchOptions): Promise<TrackSearchResult[]> {
        if (!query || query.trim().length === 0) {
            return [];
        }

        const tsquery = this.queryToTsquery(query);
        if (!tsquery) {
            return this.searchTracksFallback({ query, limit, offset });
        }

        try {
            const results = await prisma.$queryRaw<TrackSearchResult[]>`
        SELECT
          t.id,
          t.title,
          t."albumId",
          t.duration,
          a.title as "albumTitle",
          a."artistId",
          ar.name as "artistName",
          ts_rank(t."searchVector", to_tsquery('english', ${tsquery})) AS rank
        FROM "Track" t
        LEFT JOIN "Album" a ON t."albumId" = a.id
        LEFT JOIN "Artist" ar ON a."artistId" = ar.id
        WHERE t."searchVector" @@ to_tsquery('english', ${tsquery})
        ORDER BY rank DESC, t.title ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

            return results.length > 0 ? results : this.searchTracksFallback({ query, limit, offset });
        } catch (error) {
            logger.error("Track search error:", error);
            return this.searchTracksFallback({ query, limit, offset });
        }
    }

    async searchAll({
        query,
        limit = 10,
        genre,
    }: SearchOptions & { genre?: string }): Promise<SearchResults> {
        if (!query || query.trim().length === 0) {
            return {
                artists: [],
                albums: [],
                tracks: [],
            };
        }

        // Check Redis cache first
        const cacheKey = `search:all:${normalizeCacheQuery(query)}:${limit}:${genre || ""}`;
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                logger.debug(`[SEARCH] Cache HIT for query: "${query}"`);
                return JSON.parse(cached);
            }
        } catch (err) {
            logger.warn("[SEARCH] Redis cache read error:", err);
        }

        logger.debug(
            `[SEARCH]  Cache MISS for query: "${query}" - fetching from database`
        );

        const [artists, albums, tracks] =
            await Promise.all([
                this.searchArtists({ query, limit }),
                this.searchAlbums({ query, limit }),
                this.searchTracks({ query, limit }),
            ]);

        const results = {
            artists,
            albums,
            tracks: genre ? await this.filterTracksByGenre(tracks, genre) : tracks,
        };

        // Cache for 5 minutes (balance freshness vs performance)
        try {
            await redisClient.setex(cacheKey, 300, JSON.stringify(results));
        } catch (err) {
            logger.warn("[SEARCH] Redis cache write error:", err);
        }

        return results;
    }

    /**
     * Filter tracks by genre
     */
    async filterTracksByGenre(
        tracks: TrackSearchResult[],
        genre: string
    ): Promise<TrackSearchResult[]> {
        if (tracks.length === 0) return [];

        const trackIds = tracks.map((t) => t.id);
        const tracksWithGenre = await prisma.track.findMany({
            where: {
                id: { in: trackIds },
                trackGenres: {
                    some: {
                        genre: {
                            name: {
                                equals: genre,
                                mode: "insensitive",
                            },
                        },
                    },
                },
            },
            select: { id: true },
        });

        const genreTrackIds = new Set(tracksWithGenre.map((t) => t.id));
        return tracks.filter((t) => genreTrackIds.has(t.id));
    }

    /**
     * Search by specific type with caching
     */
    async searchByType({
        query,
        type,
        limit = 20,
        offset = 0,
        genre,
    }: SearchByTypeOptions): Promise<SearchResults> {
        const results: SearchResults = {
            artists: [],
            albums: [],
            tracks: [],
        };

        if (!query || query.trim().length === 0) {
            return results;
        }

        // Check cache
        const cacheKey = `search:${type}:${normalizeCacheQuery(query)}:${limit}:${genre || ""}`;
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                logger.debug(`[SEARCH] Cache HIT for ${type} query: "${query}"`);
                return JSON.parse(cached);
            }
        } catch (err) {
            logger.warn("[SEARCH] Redis read error:", err);
        }

        // Execute single-type search
        switch (type) {
            case "artists":
                results.artists = await this.searchArtists({ query, limit, offset });
                break;
            case "albums":
                results.albums = await this.searchAlbums({ query, limit, offset });
                break;
            case "tracks": {
                let tracks = await this.searchTracks({ query, limit, offset });
                if (genre) {
                    tracks = await this.filterTracksByGenre(tracks, genre);
                }
                results.tracks = tracks;
                break;
            }
        }

        // Cache for 2 minutes
        try {
            await redisClient.setex(cacheKey, 120, JSON.stringify(results));
        } catch (err) {
            logger.warn("[SEARCH] Redis write error:", err);
        }

        return results;
    }
}

export const searchService = new SearchService();
