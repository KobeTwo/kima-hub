jest.mock("../../utils/db", () => ({
    prisma: {
        playlist: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
        },
    },
}));

jest.mock("../../utils/systemSettings", () => ({
    getSystemSettings: jest.fn(),
}));

jest.mock("../../utils/userNavidromeSettings", () => ({
    getUserNavidromeSettings: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    },
}));

jest.mock("axios", () => ({
    __esModule: true,
    default: { post: jest.fn() },
}));

import axios from "axios";
import { prisma } from "../../utils/db";
import { getSystemSettings } from "../../utils/systemSettings";
import { getUserNavidromeSettings } from "../../utils/userNavidromeSettings";
import { navidromeSync } from "../navidromeSync";

const mockedAxios = jest.mocked(axios);
const mockedPrisma = jest.mocked(prisma);
const mockedSettings = jest.mocked(getSystemSettings);
const mockedUserSettings = jest.mocked(getUserNavidromeSettings);

const SETTINGS = {
    navidromeSyncEnabled: true,
    navidromeUrl: "http://navidrome:4533/",
    navidromeUser: "robert",
    navidromePassword: "secret",
    navidromeNamePrefix: "",
};

function ok(payload: Record<string, unknown> = {}) {
    return {
        status: 200,
        data: { "subsonic-response": { status: "ok", ...payload } },
    };
}

const PLAYLIST = {
    id: "pl-1",
    mixId: null,
    name: "Road Trip",
    items: [
        {
            sort: 1,
            track: {
                id: "t1",
                title: "Wonderwall",
                duration: 228,
                isrc: "USX120400001",
                album: {
                    title: "(What's the Story) Morning Glory?",
                    artist: { name: "Oasis", displayName: null },
                },
            },
        },
        {
            sort: 2,
            track: {
                id: "t2",
                title: "No Signal",
                duration: 200,
                isrc: null,
                album: {
                    title: "In the End",
                    artist: { name: "The Weeknd", displayName: null },
                },
            },
        },
    ],
};

// Call order (match-before-write): search3 t1, search3 t2,
// getPlaylists, deletePlaylist, createPlaylist
function playlistWithExistingNavidromeCopy() {
    mockedAxios.post
        .mockResolvedValueOnce(
            ok({
                searchResult3: {
                    song: [
                        {
                            id: "w-1",
                            title: "Wonderwall (1995 Remaster)",
                            artist: "Oasis",
                            album: "(What's the Story) Morning Glory?",
                            duration: 228,
                            isrc: ["USX120400001"],
                        },
                    ],
                },
            })
        )
        .mockResolvedValueOnce(
            ok({
                searchResult3: {
                    song: [
                        {
                            id: "n-1",
                            title: "No Signal",
                            artist: "The Weeknd",
                            album: "In the End",
                            duration: 200,
                        },
                    ],
                },
            })
        )
        .mockResolvedValueOnce(
            ok({
                playlists: {
                    playlist: [{ id: "np-9", name: "Road Trip" }],
                },
            })
        )
        .mockResolvedValueOnce(ok()) // deletePlaylist
        .mockResolvedValueOnce(ok()); // createPlaylist
}

describe("navidromeSync", () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        mockedSettings.mockResolvedValue(SETTINGS as never);
        mockedUserSettings.mockResolvedValue(null);
        // drain any pending dirty playlists from previous tests
        await navidromeSync.flush();
    });

    describe("syncPlaylist", () => {
        it("deletes the existing copy and recreates it with song ids in playlist order", async () => {
            mockedPrisma.playlist.findUnique.mockResolvedValue(
                PLAYLIST as never
            );
            playlistWithExistingNavidromeCopy();

            const [result] = await navidromeSync.syncPlaylist("pl-1");

            expect(result.status).toBe("synced");
            expect(result.matched).toBe(2);
            expect(result.total).toBe(2);

            expect(mockedAxios.post).toHaveBeenCalledTimes(5);
            const urls = mockedAxios.post.mock.calls.map((c) => c[0] as string);
            // match-before-write: search3, search3, getPlaylists, deletePlaylist, createPlaylist
            expect(urls[0]).toBe("http://navidrome:4533/rest/search3.view");
            expect(urls[1]).toBe("http://navidrome:4533/rest/search3.view");
            expect(urls[2]).toBe("http://navidrome:4533/rest/getPlaylists.view");
            expect(urls[3]).toBe("http://navidrome:4533/rest/deletePlaylist.view");
            expect(urls[4]).toBe("http://navidrome:4533/rest/createPlaylist.view");

            const createBody = mockedAxios.post.mock.calls[4][1] as URLSearchParams;
            expect(Array.from(createBody.getAll("songId"))).toEqual([
                "w-1",
                "n-1",
            ]);
            expect(createBody.get("name")).toBe("Road Trip");
            expect(createBody.get("u")).toBe("robert");
            expect(createBody.get("p")).toBe("secret");
            expect(createBody.get("v")).toBe("1.16.1");
            expect(createBody.get("f")).toBe("json");
        });

        it("creates without delete when no copy exists", async () => {
            mockedPrisma.playlist.findUnique.mockResolvedValue(
                PLAYLIST as never
            );
            mockedAxios.post
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [
                                {
                                    id: "w-1",
                                    title: "Wonderwall",
                                    artist: "Oasis",
                                    duration: 228,
                                    isrc: ["USX120400001"],
                                },
                            ],
                        },
                    })
                )
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [
                                {
                                    id: "n-1",
                                    title: "No Signal",
                                    artist: "The Weeknd",
                                    duration: 200,
                                },
                            ],
                        },
                    })
                )
                .mockResolvedValueOnce(
                    ok({ playlists: { playlist: [] } })
                )
                .mockResolvedValueOnce(ok());

            const [result] = await navidromeSync.syncPlaylist("pl-1");

            expect(result.status).toBe("synced");
            const urls = mockedAxios.post.mock.calls.map((c) => c[0] as string);
            expect(urls).not.toContain(
                "http://navidrome:4533/rest/deletePlaylist.view"
            );
        });

        it("skips empty playlists without calling Navidrome", async () => {
            mockedPrisma.playlist.findUnique.mockResolvedValue({
                id: "pl-2",
                mixId: null,
                name: "Empty",
                items: [],
            } as never);

            const [result] = await navidromeSync.syncPlaylist("pl-2");

            expect(result.status).toBe("skipped_empty");
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it("skips mix playlists without calling Navidrome", async () => {
            mockedPrisma.playlist.findUnique.mockResolvedValue({
                id: "pl-3",
                mixId: "mix-1",
                name: "Vibe Mix",
                items: [PLAYLIST.items[0]],
            } as never);

            const [result] = await navidromeSync.syncPlaylist("pl-3");

            expect(result.status).toBe("skipped_mix");
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it("returns skipped_not_found for unknown ids", async () => {
            mockedPrisma.playlist.findUnique.mockResolvedValue(null);

            const [result] = await navidromeSync.syncPlaylist("nope");

            expect(result.status).toBe("skipped_not_found");
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it("excludes unmatched tracks from songIds and reports them missing", async () => {
            mockedPrisma.playlist.findUnique.mockResolvedValue(
                PLAYLIST as never
            );
            // Call order (match-before-write): search3 "Wonderwall Oasis"
            // (t1 hit), search3 "No Signal The Weeknd" (t2 q1, empty),
            // search3 "No Signal" (t2 q2, empty), getPlaylists, createPlaylist
            mockedAxios.post
                .mockResolvedValueOnce(
                    ok({ searchResult3: { song: [{ id: "w-1", title: "Wonderwall", artist: "Oasis", isrc: ["USX120400001"], duration: 228 }] } })
                )
                .mockResolvedValueOnce(
                    ok({ searchResult3: { song: [] } }) // No Signal not found
                )
                .mockResolvedValueOnce(
                    ok({ searchResult3: { song: [] } }) // t2 second query
                )
                .mockResolvedValueOnce(ok({ playlists: { playlist: [] } }))
                .mockResolvedValueOnce(ok()); // createPlaylist

            const [result] = await navidromeSync.syncPlaylist("pl-1");

            expect(result.status).toBe("synced");
            expect(result.matched).toBe(1);
            expect(result.missing).toHaveLength(1);
            expect(result.missing![0]).toContain("The Weeknd - No Signal");
            const createBody =
                mockedAxios.post.mock.calls[4][1] as URLSearchParams;
            expect(Array.from(createBody.getAll("songId"))).toEqual(["w-1"]);
        });

        it("does nothing when sync is disabled or misconfigured", async () => {
            mockedSettings.mockResolvedValue(
                { ...SETTINGS, navidromeSyncEnabled: false } as never
            );
            mockedPrisma.playlist.findUnique.mockResolvedValue(
                PLAYLIST as never
            );

            const [result] = await navidromeSync.syncPlaylist("pl-1");

            expect(result.status).toBe("skipped_not_configured");
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it("applies the name prefix to the Navidrome playlist name", async () => {
            mockedSettings.mockResolvedValue(
                { ...SETTINGS, navidromeNamePrefix: "KIMA " } as never
            );
            mockedPrisma.playlist.findUnique.mockResolvedValue(
                PLAYLIST as never
            );
            mockedAxios.post
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [
                                { id: "w-1", title: "Wonderwall", artist: "Oasis", duration: 228, isrc: ["USX120400001"] },
                            ],
                        },
                    })
                )
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [
                                { id: "n-1", title: "No Signal", artist: "The Weeknd", duration: 200 },
                            ],
                        },
                    })
                )
                .mockResolvedValueOnce(ok({ playlists: { playlist: [] } }))
                .mockResolvedValueOnce(ok());

            const [result] = await navidromeSync.syncPlaylist("pl-1");

            expect(result.status).toBe("synced");
            expect(result.name).toBe("KIMA Road Trip");
            // no existing copy -> 4 calls: search3, search3, getPlaylists, createPlaylist
            const createBody =
                mockedAxios.post.mock.calls[3][1] as URLSearchParams;
            expect(createBody.get("name")).toBe("KIMA Road Trip");
        });

        it("skips when enabled but credentials are incomplete", async () => {
            mockedSettings.mockResolvedValue(
                { ...SETTINGS, navidromePassword: null } as never
            );
            mockedPrisma.playlist.findUnique.mockResolvedValue(
                PLAYLIST as never
            );
            const [result] = await navidromeSync.syncPlaylist("pl-1");
            expect(result.status).toBe("skipped_not_configured");
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it("leaves the existing copy untouched when no track matches", async () => {
            mockedPrisma.playlist.findUnique.mockResolvedValue(
                PLAYLIST as never
            );
            // 4 search3 calls (2 queries per track), all empty; no write
            // phase (getPlaylists/delete/create) must occur.
            mockedAxios.post
                .mockResolvedValueOnce(
                    ok({ searchResult3: { song: [] } })
                )
                .mockResolvedValueOnce(
                    ok({ searchResult3: { song: [] } })
                )
                .mockResolvedValueOnce(
                    ok({ searchResult3: { song: [] } })
                )
                .mockResolvedValueOnce(
                    ok({ searchResult3: { song: [] } })
                );

            const [result] = await navidromeSync.syncPlaylist("pl-1");

            expect(result.status).toBe("skipped_no_matches");
            expect(result.matched).toBe(0);
            expect(result.missing).toHaveLength(2);
            expect(mockedAxios.post).toHaveBeenCalledTimes(4);
            const urls = mockedAxios.post.mock.calls.map((c) => c[0] as string);
            expect(urls).not.toContain(
                "http://navidrome:4533/rest/getPlaylists.view"
            );
            expect(urls).not.toContain(
                "http://navidrome:4533/rest/createPlaylist.view"
            );
        });
    });

    describe("concurrency", () => {
        it("dedupes concurrent syncPlaylist calls for the same playlist", async () => {
            let resolveFindUnique: (v: unknown) => void;
            const gate = new Promise((res) => {
                resolveFindUnique = res;
            });
            // findUnique wird einmal pro Ziel-Ausführung aufgerufen (1 Ziel)
            mockedPrisma.playlist.findUnique.mockReturnValue(gate as never);
            playlistWithExistingNavidromeCopy();

            const first = navidromeSync.syncPlaylist("pl-1");
            const second = navidromeSync.syncPlaylist("pl-1");

            // Beide teilen sich dieselbe In-Flight-Promises pro Ziel
            resolveFindUnique!(PLAYLIST);
            const [r1, r2] = await Promise.all([first, second]);
            expect(r1[0]).toBe(r2[0]);
            // genau eine Ausführung: getPlaylists, delete, 2x search3, create
            expect(mockedAxios.post).toHaveBeenCalledTimes(5);
        });
    });

    describe("testConnection", () => {
        it("returns ok for a healthy server", async () => {
            mockedAxios.post.mockResolvedValueOnce(ok({ playlists: {} }));
            const result = await navidromeSync.testConnection(
                "http://navidrome:4533",
                "robert",
                "secret"
            );
            expect(result.ok).toBe(true);
        });

        it("returns the error message when the server rejects", async () => {
            mockedAxios.post.mockRejectedValueOnce(
                new Error("Navidrome getPlaylists failed: 401")
            );
            const result = await navidromeSync.testConnection(
                "http://navidrome:4533",
                "robert",
                "wrong"
            );
            expect(result.ok).toBe(false);
            expect(result.error).toContain("401");
        });
    });

    describe("syncAll", () => {
        it("syncs every non-mix playlist", async () => {
            mockedPrisma.playlist.findMany.mockResolvedValue([
                { id: "pl-1" },
                { id: "pl-2" },
            ] as never);
            // Neue Ziel-Listen-Implementierung lädt pro Playlist zweimal
            // (syncPlaylist-Load + doSyncPlaylist-Load); pl-2 ist leer und
            // wird bereits im syncPlaylist-Load gescipped (nur 1 Load).
            mockedPrisma.playlist.findUnique
                .mockResolvedValueOnce(PLAYLIST as never)
                .mockResolvedValueOnce(PLAYLIST as never)
                .mockResolvedValueOnce({
                    id: "pl-2",
                    mixId: null,
                    name: "Other",
                    items: [],
                } as never);
            // pl-1 (match-before-write): search3 (t1 "Wonderwall Oasis"),
            // search3 (t2 "No Signal The Weeknd"), getPlaylists, createPlaylist;
            // pl-2 empty
            mockedAxios.post
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [
                                { id: "w-1", title: "Wonderwall", artist: "Oasis", isrc: ["USX120400001"], duration: 228 },
                            ],
                        },
                    })
                )
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [
                                { id: "n-1", title: "No Signal", artist: "The Weeknd", duration: 200 },
                            ],
                        },
                    })
                )
                .mockResolvedValueOnce(ok({ playlists: { playlist: [] } }))
                .mockResolvedValueOnce(ok());

            const results = await navidromeSync.syncAll();

            expect(results.map((r) => r.status)).toEqual([
                "synced",
                "skipped_empty",
            ]);
        });
    });

    describe("error handling", () => {
        it("returns error status when Navidrome rejects the call", async () => {
            mockedPrisma.playlist.findUnique.mockResolvedValue(
                PLAYLIST as never
            );
            // Matching succeeds; createPlaylist is rejected.
            mockedAxios.post
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [
                                { id: "w-1", title: "Wonderwall", artist: "Oasis", isrc: ["USX120400001"], duration: 228 },
                            ],
                        },
                    })
                )
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [
                                { id: "n-1", title: "No Signal", artist: "The Weeknd", duration: 200 },
                            ],
                        },
                    })
                )
                .mockResolvedValueOnce(ok({ playlists: { playlist: [] } }))
                .mockRejectedValueOnce(
                    new Error("Navidrome createPlaylist failed: 500")
                );

            const [result] = await navidromeSync.syncPlaylist("pl-1");

            expect(result.status).toBe("error");
            expect(result.error).toContain("500");
        });
    });

    describe("debounce / flush", () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
            // Stale fake-timer handles are discarded on useRealTimers();
            // reset the service's timer state so the next test creates a
            // fresh interval in its own fake-timer environment.
            // NOTE: ordering matters — this block must run while fake timers are being restored; do not add fake-timer tests after a real-timer test without resetting timer state here.
            (navidromeSync as unknown as { timer: unknown }).timer = null;
            (navidromeSync as unknown as { dirty: Set<string> }).dirty.clear();
        });

        it("coalesces markDirty calls into one flush after 60s", async () => {
            mockedPrisma.playlist.findUnique.mockResolvedValue(
                PLAYLIST as never
            );
            playlistWithExistingNavidromeCopy();

            navidromeSync.markDirty("pl-1");
            navidromeSync.markDirty("pl-1");

            await jest.advanceTimersByTimeAsync(60_000);

            // one sync pass: getPlaylists called exactly once
            const getPlaylistsCalls = mockedAxios.post.mock.calls.filter(
                (c) => (c[0] as string).includes("getPlaylists")
            );
            expect(getPlaylistsCalls).toHaveLength(1);
            // syncPlaylist-Load + doSyncPlaylist-Load (1 Ziel) = 2 Aufrufe
            expect(mockedPrisma.playlist.findUnique).toHaveBeenCalledTimes(2);
        });

        it("skips a second concurrent flush (guard)", async () => {
            // Hold the first flush open with a deferred findUnique promise so
            // the 60s timer fires while flushing === true.
            let resolveFindUnique: (v: unknown) => void;
            const findUniqueGate = new Promise((res) => {
                resolveFindUnique = res;
            });
            mockedPrisma.playlist.findUnique.mockReturnValue(
                findUniqueGate as never
            );
            playlistWithExistingNavidromeCopy();

            navidromeSync.markDirty("pl-1");
            const first = navidromeSync.flush();
            // same playlist goes dirty again mid-flush
            navidromeSync.markDirty("pl-1");
            await jest.advanceTimersByTimeAsync(60_000); // timer fires, guard must skip

            // Only the manual flush may have started; the timer-fired
            // flush must have been skipped by the guard.
            expect(
                mockedPrisma.playlist.findUnique.mock.calls.length
            ).toBeLessThanOrEqual(1);

            resolveFindUnique!(PLAYLIST);
            await first;
        });

        it("retries a failed playlist on the next 60s tick", async () => {
            mockedPrisma.playlist.findUnique.mockResolvedValue(
                PLAYLIST as never
            );
            // Tick 1: matching succeeds, createPlaylist fails (Navidrome down)
            // → status "error" → re-queued for the next tick.
            mockedAxios.post
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [
                                { id: "w-1", title: "Wonderwall", artist: "Oasis", duration: 228, isrc: ["USX120400001"] },
                            ],
                        },
                    })
                )
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [
                                { id: "n-1", title: "No Signal", artist: "The Weeknd", duration: 200 },
                            ],
                        },
                    })
                )
                .mockResolvedValueOnce(ok({ playlists: { playlist: [] } }))
                .mockRejectedValueOnce(
                    new Error("Navidrome createPlaylist failed: 503")
                )
                // Tick 2: Navidrome is back — full successful sync
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [
                                { id: "w-1", title: "Wonderwall", artist: "Oasis", duration: 228, isrc: ["USX120400001"] },
                            ],
                        },
                    })
                )
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [
                                { id: "n-1", title: "No Signal", artist: "The Weeknd", duration: 200 },
                            ],
                        },
                    })
                )
                .mockResolvedValueOnce(ok({ playlists: { playlist: [] } }))
                .mockResolvedValueOnce(ok());

            navidromeSync.markDirty("pl-1");
            await jest.advanceTimersByTimeAsync(60_000); // tick 1 → error → re-queued
            await jest.advanceTimersByTimeAsync(60_000); // tick 2 → retry succeeds

            const getPlaylistsCalls = mockedAxios.post.mock.calls.filter(
                (c) => (c[0] as string).includes("getPlaylists")
            );
            expect(getPlaylistsCalls).toHaveLength(2);
        });
    });

    const PERSONAL = {
        userId: "u-anna",
        enabled: true,
        url: "http://nd2:4533",
        navidromeUser: "anna",
        navidromePassword: "anna-secret",
        namePrefix: "Anna: ",
    };

    describe("resolveTargets", () => {
        it("returns the global target when global is configured", async () => {
            const targets = await navidromeSync.resolveTargets({ userId: "u-anna" });
            expect(targets).toHaveLength(1);
            expect(targets[0].key).toBe("global");
            expect(targets[0].label).toBe("global");
            expect(targets[0].settings.user).toBe("robert");
        });

        it("returns both targets when personal settings are active", async () => {
            mockedUserSettings.mockResolvedValue(PERSONAL as never);
            const targets = await navidromeSync.resolveTargets({ userId: "u-anna" });
            expect(targets.map((t) => t.key)).toEqual([
                "global",
                "personal:u-anna",
            ]);
        });

        it("returns only personal when global is disabled (Review Focus 1)", async () => {
            mockedSettings.mockResolvedValue(
                { ...SETTINGS, navidromeSyncEnabled: false } as never
            );
            mockedUserSettings.mockResolvedValue(PERSONAL as never);
            const targets = await navidromeSync.resolveTargets({ userId: "u-anna" });
            expect(targets.map((t) => t.key)).toEqual(["personal:u-anna"]);
        });

        it("skips the personal target when enabled but incomplete (Review Focus 1)", async () => {
            mockedUserSettings.mockResolvedValue(
                { ...PERSONAL, navidromePassword: null } as never
            );
            const targets = await navidromeSync.resolveTargets({ userId: "u-anna" });
            expect(targets.map((t) => t.key)).toEqual(["global"]);
        });

        it("returns no targets when neither is configured", async () => {
            mockedSettings.mockResolvedValue(
                { ...SETTINGS, navidromeSyncEnabled: false } as never
            );
            const targets = await navidromeSync.resolveTargets({ userId: "u-x" });
            expect(targets).toHaveLength(0);
        });

        it("dedupes identical global/personal targets incl. case + trailing slash (Review Focus 3)", async () => {
            // Global: http://navidrome:4533/ , user "robert", prefix ""
            // Persönlich: http://navidrome:4533 (keine End-Schrägstriche), user "ROBERT", Prefix ""
            mockedUserSettings.mockResolvedValue(
                {
                    userId: "u-anna",
                    enabled: true,
                    url: "http://navidrome:4533",
                    navidromeUser: "ROBERT",
                    navidromePassword: "secret",
                    namePrefix: "",
                } as never
            );
            const targets = await navidromeSync.resolveTargets({ userId: "u-anna" });
            expect(targets).toHaveLength(1);
            expect(targets[0].key).toBe("global"); // erstes Ziel bleibt
        });
    });

    describe("multi-target sync", () => {
        function personalNavidromeCopy() {
            // 2x search3 (2 Tracks) + getPlaylists + createPlaylist für das persönliche Ziel
            mockedAxios.post
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [
                                { id: "aw-1", title: "Wonderwall", artist: "Oasis", isrc: ["USX120400001"], duration: 228 },
                            ],
                        },
                    })
                )
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [{ id: "an-1", title: "No Signal", artist: "The Weeknd", duration: 200 }],
                        },
                    })
                )
                .mockResolvedValueOnce(ok({ playlists: { playlist: [] } }))
                .mockResolvedValueOnce(ok());
        }

        it("syncs to both targets and reports one result per target", async () => {
            mockedPrisma.playlist.findUnique.mockResolvedValue(PLAYLIST as never);
            mockedUserSettings.mockResolvedValue(PERSONAL as never);
            playlistWithExistingNavidromeCopy(); // globales Ziel
            personalNavidromeCopy(); // persönliches Ziel

            const results = await navidromeSync.syncPlaylist("pl-1");

            expect(results.map((r) => r.target)).toEqual(["global", "personal"]);
            expect(results.every((r) => r.status === "synced")).toBe(true);
            // globales Ziel: Name ohne Prefix; persönliches Ziel: mit "Anna: "
            expect(results[0].name).toBe("Road Trip");
            expect(results[1].name).toBe("Anna: Road Trip");
        });

        it("isolates targets: 0 matches on global does not block personal (Review Focus 1)", async () => {
            mockedPrisma.playlist.findUnique.mockResolvedValue(PLAYLIST as never);
            mockedUserSettings.mockResolvedValue(PERSONAL as never);
            // globales Ziel: 4x leeres search3 (2 Queries x 2 Tracks) -> 0 Matches
            mockedAxios.post
                .mockResolvedValueOnce(ok({ searchResult3: { song: [] } }))
                .mockResolvedValueOnce(ok({ searchResult3: { song: [] } }))
                .mockResolvedValueOnce(ok({ searchResult3: { song: [] } }))
                .mockResolvedValueOnce(ok({ searchResult3: { song: [] } }))
                // persönliches Ziel: alles gefunden
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [{ id: "aw-1", title: "Wonderwall", artist: "Oasis", isrc: ["USX120400001"], duration: 228 }],
                        },
                    })
                )
                .mockResolvedValueOnce(
                    ok({
                        searchResult3: {
                            song: [{ id: "an-1", title: "No Signal", artist: "The Weeknd", duration: 200 }],
                        },
                    })
                )
                .mockResolvedValueOnce(ok({ playlists: { playlist: [] } }))
                .mockResolvedValueOnce(ok());

            const results = await navidromeSync.syncPlaylist("pl-1");

            expect(results[0].target).toBe("global");
            expect(results[0].status).toBe("skipped_no_matches");
            expect(results[1].target).toBe("personal");
            expect(results[1].status).toBe("synced");
        });

        it("reports skipped_not_configured when no target resolves", async () => {
            mockedSettings.mockResolvedValue(
                { ...SETTINGS, navidromeSyncEnabled: false } as never
            );
            mockedPrisma.playlist.findUnique.mockResolvedValue(PLAYLIST as never);

            const results = await navidromeSync.syncPlaylist("pl-1");

            expect(results).toEqual([
                expect.objectContaining({
                    status: "skipped_not_configured",
                    target: "none",
                }),
            ]);
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });
    });

    describe("syncUserPlaylists", () => {
        it("only fetches that user's non-mix playlists (Review Focus 5)", async () => {
            mockedPrisma.playlist.findMany.mockResolvedValue([{ id: "pl-1" }] as never);
            mockedPrisma.playlist.findUnique.mockResolvedValue({
                id: "pl-1",
                mixId: null,
                name: "Empty",
                items: [],
            } as never);
            mockedSettings.mockResolvedValue(
                { ...SETTINGS, navidromeSyncEnabled: false } as never
            );

            const results = await navidromeSync.syncUserPlaylists("u-anna");

            expect(mockedPrisma.playlist.findMany).toHaveBeenCalledWith({
                where: { userId: "u-anna", mixId: null },
                select: { id: true },
                orderBy: { createdAt: "asc" },
            });
            expect(results).toHaveLength(1);
            expect(results[0].status).toBe("skipped_empty");
        });
    });
});
