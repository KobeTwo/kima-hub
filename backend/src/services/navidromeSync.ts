import axios from "axios";
import { prisma } from "../utils/db";
import { logger } from "../utils/logger";
import { getSystemSettings } from "../utils/systemSettings";
import { getUserNavidromeSettings } from "../utils/userNavidromeSettings";
import {
    NavidromeSong,
    MatchTarget,
    buildSearchQueries,
    pickBestMatch,
} from "./navidromeMatching";

const SUBSONIC_VERSION = "1.16.1";
const CLIENT_NAME = "kima-navidrome-sync";
const FLUSH_INTERVAL_MS = 60_000;
const CALL_TIMEOUT_MS = 30_000;
const CREATE_TIMEOUT_MS = 120_000;

export interface SyncResult {
    playlistId: string;
    name: string;
    status:
        | "synced"
        | "skipped_empty"
        | "skipped_mix"
        | "skipped_not_found"
        | "skipped_not_configured"
        | "skipped_no_matches"
        | "error";
    matched?: number;
    total?: number;
    missing?: string[];
    error?: string;
    /** Welches Ziel das Ergebnis gehört: "global" (Admin-Settings), "personal" (User-Settings) oder "none" (Mix/leer/unkonfiguriert). */
    target?: "global" | "personal" | "none";
}

export interface SyncTargetSettings {
    url: string;
    user: string;
    password: string;
    namePrefix: string;
}

export interface SyncTarget {
    key: string;
    label: "global" | "personal";
    settings: SyncTargetSettings;
}

class NavidromeSyncService {
    private dirty = new Set<string>();
    private timer: NodeJS.Timeout | null = null;
    private flushing = false;
    // In-Flight-Dedup läuft pro (playlistId, target)
    private inFlight = new Map<string, Promise<SyncResult>>();

    /** Register a playlist for the next flush. Never throws. */
    markDirty(playlistId: string): void {
        try {
            if (!playlistId) return;
            this.dirty.add(playlistId);
            this.ensureTimer();
            logger.debug(
                `[NavidromeSync] marked dirty: ${playlistId} (${this.dirty.size} pending)`
            );
        } catch (error) {
            logger.error("[NavidromeSync] markDirty failed:", error);
        }
    }

    private ensureTimer(): void {
        if (this.timer) return;
        this.timer = setInterval(() => {
            this.flush().catch((error) => {
                logger.error("[NavidromeSync] flush failed:", error);
            });
        }, FLUSH_INTERVAL_MS);
        // Don't keep the Node process alive solely for this poller.
        this.timer.unref?.();
    }

    /** Sync all currently dirty playlists. */
    async flush(): Promise<void> {
        if (this.flushing) return;
        this.flushing = true;
        try {
            const ids = Array.from(this.dirty);
            this.dirty.clear();
            if (ids.length === 0) return;
            logger.info(`[NavidromeSync] flushing ${ids.length} playlist(s)`);
            for (const id of ids) {
                let results: SyncResult[] | undefined;
                try {
                    results = await this.syncPlaylist(id);
                } catch (error: any) {
                    logger.error(
                        `[NavidromeSync] Unexpected error for ${id}:`,
                        error
                    );
                }
                if (results?.some((r) => r.status === "error")) {
                    // Spec §5: the next 60s tick retries failed playlists.
                    this.dirty.add(id);
                }
            }
        } finally {
            this.flushing = false;
        }
    }

    /**
     * Löst die Sync-Ziele für eine Playlist auf: Global-Target (admin-Settings)
     * + persönliches Target (UserNavidromeSettings), dedupliziert nach
     * normalisierter (url, user, prefix)-Tupel.
     */
    async resolveTargets(playlist: { userId: string }): Promise<SyncTarget[]> {
        const targets: SyncTarget[] = [];

        const s = await getSystemSettings();
        if (
            s &&
            s.navidromeSyncEnabled &&
            s.navidromeUrl &&
            s.navidromeUser &&
            s.navidromePassword
        ) {
            targets.push({
                key: "global",
                label: "global",
                settings: {
                    url: s.navidromeUrl,
                    user: s.navidromeUser,
                    password: s.navidromePassword,
                    namePrefix: s.navidromeNamePrefix ?? "",
                },
            });
        }

        const p = await getUserNavidromeSettings(playlist.userId);
        if (p && p.enabled && p.url && p.navidromeUser && p.navidromePassword) {
            targets.push({
                key: `personal:${playlist.userId}`,
                label: "personal",
                settings: {
                    url: p.url,
                    user: p.navidromeUser,
                    password: p.navidromePassword,
                    namePrefix: p.namePrefix ?? "",
                },
            });
        }

        // Dedup: gleiche (url, user, prefix) -> nur erster Eintrag bleibt.
        const seen = new Set<string>();
        return targets.filter((t) => {
            const norm = [
                t.settings.url.replace(/\/+$/, "").toLowerCase(),
                t.settings.user.toLowerCase(),
                t.settings.namePrefix.toLowerCase(),
            ].join("|");
            if (seen.has(norm)) return false;
            seen.add(norm);
            return true;
        });
    }

    /**
     * Sync eine Playlist zu allen aufgelösten Zielen (global + persönliches).
     * Rückgabe: 1 Result pro Ziel (oder 1 "none"-Result für Mix/leer/unkonfiguriert).
     * In-Flight-Dedup läuft pro (playlistId, target); Ziele werden sequenziell
     * ausgeführt (deterministisch + freundlich zum Navidrome-Server).
     */
    async syncPlaylist(playlistId: string): Promise<SyncResult[]> {
        const playlist = await prisma.playlist.findUnique({
            where: { id: playlistId },
            include: {
                items: {
                    orderBy: { sort: "asc" },
                    include: {
                        track: {
                            select: {
                                id: true,
                                title: true,
                                duration: true,
                                isrc: true,
                                album: {
                                    select: {
                                        title: true,
                                        artist: {
                                            select: {
                                                name: true,
                                                displayName: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!playlist) {
            return [
                {
                    playlistId,
                    name: "",
                    status: "skipped_not_found",
                    target: "none",
                },
            ];
        }
        if (playlist.mixId) {
            return [
                {
                    playlistId,
                    name: playlist.name,
                    status: "skipped_mix",
                    target: "none",
                },
            ];
        }
        if (playlist.items.length === 0) {
            logger.info(
                `[NavidromeSync] skipping empty playlist ${playlistId}`
            );
            return [
                {
                    playlistId,
                    name: playlist.name,
                    status: "skipped_empty",
                    target: "none",
                },
            ];
        }

        const targets = await this.resolveTargets(playlist);
        if (targets.length === 0) {
            return [
                {
                    playlistId,
                    name: playlist.name,
                    status: "skipped_not_configured",
                    target: "none",
                    error: "no sync target configured (global + personal)",
                },
            ];
        }

        const results: SyncResult[] = [];
        for (const target of targets) {
            const key = `${playlistId}::${target.key}`;
            let run = this.inFlight.get(key);
            if (!run) {
                run = this.doSyncPlaylist(playlistId, target).finally(() => {
                    this.inFlight.delete(key);
                });
                this.inFlight.set(key, run);
            }
            results.push(await run);
        }
        return results;
    }

    /** Manueller Trigger (Admin): alle Nicht-Mix-Playlisten, je mit eigener Ziel-Liste. */
    async syncAll(): Promise<SyncResult[]> {
        const playlists = await prisma.playlist.findMany({
            where: { mixId: null },
            select: { id: true },
            orderBy: { createdAt: "asc" },
        });
        const results: SyncResult[] = [];
        for (const p of playlists) {
            results.push(...(await this.syncPlaylist(p.id)));
        }
        return results;
    }

    /** Manueller Trigger (User): nur die eigenen Nicht-Mix-Playlisten. */
    async syncUserPlaylists(userId: string): Promise<SyncResult[]> {
        const playlists = await prisma.playlist.findMany({
            where: { userId, mixId: null },
            select: { id: true },
            orderBy: { createdAt: "asc" },
        });
        const results: SyncResult[] = [];
        for (const p of playlists) {
            results.push(...(await this.syncPlaylist(p.id)));
        }
        return results;
    }

    private async doSyncPlaylist(
        playlistId: string,
        target: SyncTarget
    ): Promise<SyncResult> {
        try {
            const playlist = await prisma.playlist.findUnique({
                where: { id: playlistId },
                include: {
                    items: {
                        orderBy: { sort: "asc" },
                        include: {
                            track: {
                                select: {
                                    id: true,
                                    title: true,
                                    duration: true,
                                    isrc: true,
                                    album: {
                                        select: {
                                            title: true,
                                            artist: {
                                                select: {
                                                    name: true,
                                                    displayName: true,
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            });

            if (!playlist) {
                return {
                    playlistId,
                    name: "",
                    status: "skipped_not_found",
                    target: target.label,
                };
            }
            if (playlist.mixId) {
                return {
                    playlistId,
                    name: playlist.name,
                    status: "skipped_mix",
                    target: target.label,
                };
            }
            if (playlist.items.length === 0) {
                return {
                    playlistId,
                    name: playlist.name,
                    status: "skipped_empty",
                    target: target.label,
                };
            }

            const base = target.settings.url.replace(/\/+$/, "");
            const auth = {
                u: target.settings.user,
                p: target.settings.password,
                v: SUBSONIC_VERSION,
                c: CLIENT_NAME,
                f: "json",
            };

            // Match first, write second: a total matching failure must not
            // delete the existing Navidrome copy.
            const targetName = `${target.settings.namePrefix}${playlist.name}`;

            const songIds: string[] = [];
            const missing: string[] = [];
            const searchCache = new Map<string, NavidromeSong[]>();

            for (const item of playlist.items) {
                const artist = item.track.album.artist;
                const artistName = artist.displayName || artist.name;
                const matchTarget: MatchTarget = {
                    title: item.track.title,
                    artist: artistName,
                    album: item.track.album.title,
                    duration: item.track.duration,
                    isrc: item.track.isrc,
                };
                try {
                    const songId = await this.findSongId(
                        matchTarget,
                        base,
                        auth,
                        searchCache
                    );
                    if (songId) {
                        songIds.push(songId);
                    } else {
                        missing.push(`${artistName} - ${item.track.title}`);
                    }
                } catch (error: any) {
                    missing.push(
                        `${artistName} - ${item.track.title} (${error?.message || "search error"})`
                    );
                }
            }

            if (songIds.length === 0) {
                logger.warn(
                    `[NavidromeSync] target=${target.key} skipping "${targetName}": no tracks matched — existing Navidrome copy left untouched`
                );
                return {
                    playlistId,
                    name: targetName,
                    status: "skipped_no_matches",
                    target: target.label,
                    matched: 0,
                    total: playlist.items.length,
                    missing,
                };
            }

            const existingId = await this.findPlaylistIdByName(
                targetName,
                base,
                auth
            );
            if (existingId) {
                await this.navidromeCall(
                    "deletePlaylist",
                    { ...auth, id: existingId },
                    base
                );
            }

            await this.navidromeCall(
                "createPlaylist",
                { ...auth, name: targetName, songId: songIds },
                base
            );

            logger.info(
                `[NavidromeSync] target=${target.key} synced "${targetName}": ${songIds.length}/${playlist.items.length} tracks`
            );
            if (missing.length > 0) {
                logger.info(
                    `[NavidromeSync] target=${target.key} missing: ${missing
                        .slice(0, 20)
                        .join("; ")}`
                );
            }

            return {
                playlistId,
                name: targetName,
                status: "synced",
                target: target.label,
                matched: songIds.length,
                total: playlist.items.length,
                missing,
            };
        } catch (error: any) {
            logger.error(
                `[NavidromeSync] target=${target.key} syncPlaylist ${playlistId} failed:`,
                error
            );
            return {
                playlistId,
                name: "",
                status: "error",
                target: target.label,
                error: error?.message || String(error),
            };
        }
    }

    /** Test a connection (used by the settings UI). */
    async testConnection(
        url: string,
        user: string,
        password: string
    ): Promise<{ ok: boolean; error?: string }> {
        try {
            await this.navidromeCall(
                "getPlaylists",
                {
                    u: user,
                    p: password,
                    v: SUBSONIC_VERSION,
                    c: CLIENT_NAME,
                    f: "json",
                },
                url.replace(/\/+$/, "")
            );
            return { ok: true };
        } catch (error: any) {
            return { ok: false, error: error?.message || "Unknown error" };
        }
    }

    private async findSongId(
        target: MatchTarget,
        base: string,
        auth: Record<string, string>,
        cache: Map<string, NavidromeSong[]>
    ): Promise<string | null> {
        for (const query of buildSearchQueries(target.title, target.artist)) {
            let songs = cache.get(query);
            if (!songs) {
                songs = await this.searchSongs(query, base, auth);
                cache.set(query, songs);
            }
            const pick = pickBestMatch(songs, target);
            if (pick) return pick;
        }
        return null;
    }

    private async searchSongs(
        query: string,
        base: string,
        auth: Record<string, string>
    ): Promise<NavidromeSong[]> {
        const resp = await this.navidromeCall(
            "search3",
            { ...auth, query, songCount: "50", artistCount: "0", albumCount: "0" },
            base
        );
        const songsRaw = resp?.searchResult3?.song;
        const songs: any[] = Array.isArray(songsRaw) ? songsRaw : [];
        return songs.map((s: any) => ({
            id: String(s.id),
            title: s.title || "",
            artist: s.artist || "",
            album: s.album || "",
            duration: s.duration != null ? Number(s.duration) : undefined,
            isrc: Array.isArray(s.isrc) ? s.isrc.map(String) : undefined,
        }));
    }

    private async findPlaylistIdByName(
        targetName: string,
        base: string,
        auth: Record<string, string>
    ): Promise<string | null> {
        const resp = await this.navidromeCall("getPlaylists", auth, base);
        const playlists: any[] = resp?.playlists?.playlist || [];
        const found = playlists.find((p) => p.name === targetName);
        return found ? String(found.id) : null;
    }

    /** Subsonic REST call, form-encoded (supports repeated params). */
    private navidromeCall(
        method: string,
        params: Record<string, string | string[]>,
        base: string
    ): Promise<any> {
        const body = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (Array.isArray(value)) {
                for (const v of value) body.append(key, v);
            } else {
                body.append(key, value);
            }
        }
        return axios
            .post(`${base}/rest/${method}.view`, body, {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                timeout:
                    method === "createPlaylist" ? CREATE_TIMEOUT_MS : CALL_TIMEOUT_MS,
            })
            .then((response) => {
                const subsonic = response.data?.["subsonic-response"];
                if (!subsonic || subsonic.status !== "ok") {
                    const err = subsonic?.error;
                    throw new Error(
                        `Navidrome ${method} failed: ${
                            err?.message || `HTTP ${response.status} with unexpected body`
                        }`
                    );
                }
                return subsonic;
            });
    }
}

export const navidromeSync = new NavidromeSyncService();
