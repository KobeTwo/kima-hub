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
import { navidromeSync } from "../navidromeSync";

const mockedAxios = jest.mocked(axios);
const mockedPrisma = jest.mocked(prisma);
const mockedSettings = jest.mocked(getSystemSettings);

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
        // drain any pending dirty playlists from previous tests
        await navidromeSync.flush();
    });

    describe("syncPlaylist", () => {
        it("deletes the existing copy and recreates it with song ids in playlist order", async () => {
            mockedPrisma.playlist.findUnique.mockResolvedValue(
                PLAYLIST as never
            );
            playlistWithExistingNavidromeCopy();

            const result = await navidromeSync.syncPlaylist("pl-1");

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

            const result = await navidromeSync.syncPlaylist("pl-1");

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

            const result = await navidromeSync.syncPlaylist("pl-2");

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

            const result = await navidromeSync.syncPlaylist("pl-3");

            expect(result.status).toBe("skipped_mix");
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it("returns skipped_not_found for unknown ids", async () => {
            mockedPrisma.playlist.findUnique.mockResolvedValue(null);

            const result = await navidromeSync.syncPlaylist("nope");

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

            const result = await navidromeSync.syncPlaylist("pl-1");

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

            const result = await navidromeSync.syncPlaylist("pl-1");

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

            const result = await navidromeSync.syncPlaylist("pl-1");

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
            const result = await navidromeSync.syncPlaylist("pl-1");
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

            const result = await navidromeSync.syncPlaylist("pl-1");

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
            mockedPrisma.playlist.findUnique.mockReturnValue(gate as never);
            playlistWithExistingNavidromeCopy();

            const first = navidromeSync.syncPlaylist("pl-1");
            const second = navidromeSync.syncPlaylist("pl-1");

            // second call must share the in-flight promise
            expect(second).toBe(first);

            resolveFindUnique!(PLAYLIST);
            const [r1, r2] = await Promise.all([first, second]);
            expect(r1).toBe(r2);
            // exactly one execution: getPlaylists, delete, 2x search3, create
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
            mockedPrisma.playlist.findUnique
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

            const result = await navidromeSync.syncPlaylist("pl-1");

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
            expect(mockedPrisma.playlist.findUnique).toHaveBeenCalledTimes(1);
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
});
