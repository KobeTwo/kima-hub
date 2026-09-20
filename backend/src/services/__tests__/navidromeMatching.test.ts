import {
    NavidromeSong,
    albumScore,
    artistScore,
    buildSearchQueries,
    cleanForSearch,
    normalizeName,
    pickBestMatch,
    splitArtists,
    stripCommonSuffixes,
} from "../navidromeMatching";

describe("stripCommonSuffixes", () => {
    it("strips remastered suffixes", () => {
        expect(stripCommonSuffixes("Back in Black - 2005 Remastered")).toBe(
            "Back in Black"
        );
        expect(stripCommonSuffixes("Abbey Road - Remastered 2009")).toBe(
            "Abbey Road"
        );
    });

    it("strips edition/version suffixes", () => {
        expect(stripCommonSuffixes("Foo - 2011 Deluxe Edition")).toBe("Foo");
        expect(stripCommonSuffixes("Bar - 2005 Version")).toBe("Bar");
        expect(stripCommonSuffixes("Baz - Radio Edit")).toBe("Baz");
    });

    it("leaves plain titles untouched", () => {
        expect(stripCommonSuffixes("Wonderwall")).toBe("Wonderwall");
    });
});

describe("normalizeName", () => {
    it("lowercases and removes parentheticals", () => {
        expect(normalizeName("Hey Ya! (2003 Remaster)")).toBe("hey ya");
    });

    it("drops feat. suffixes", () => {
        expect(normalizeName("Shape of You (feat. Zayn)")).toBe("shape of you");
        expect(normalizeName("Some Song ft. Someone")).toBe("some song");
    });

    it("collapses whitespace", () => {
        expect(normalizeName("A  B   C")).toBe("a b c");
    });
});

describe("cleanForSearch", () => {
    it("keeps case but removes parentheticals and feat suffixes", () => {
        expect(cleanForSearch("Shape of You (feat. Zayn)")).toBe("Shape of You");
    });
});

describe("splitArtists", () => {
    it("splits on common separators", () => {
        expect(splitArtists("A, B & C")).toEqual(["A", "B", "C"]);
        expect(splitArtists("OutKast ft. CeeLo Green")).toEqual([
            "OutKast",
            "CeeLo Green",
        ]);
    });

    it("returns [] for empty input", () => {
        expect(splitArtists("")).toEqual([]);
    });
});

describe("buildSearchQueries", () => {
    it("builds title+artist, title+first-artist, title queries", () => {
        // cleanForSearch keeps case and only strips suffixes/parens/feat, so
        // commas stay in the combined query (FTS treats them as separators).
        expect(buildSearchQueries("Song", "A, B")).toEqual([
            "Song A, B",
            "Song A",
            "Song",
        ]);
    });

    it("dedupes when first artist equals full artist string", () => {
        expect(buildSearchQueries("Hey Ya!", "OutKast")).toEqual([
            "Hey Ya! OutKast",
            "Hey Ya!",
        ]);
    });

    it("falls back to the raw artist when the title is empty", () => {
        expect(buildSearchQueries("", "A")).toEqual(["A"]);
    });

    it("returns [] when both parts are empty", () => {
        expect(buildSearchQueries("", "")).toEqual([]);
    });
});

describe("pickBestMatch", () => {
    const exact: NavidromeSong = {
        id: "w-1",
        title: "Wonderwall (1995 Remaster)",
        artist: "Oasis",
        album: "(What's the Story) Morning Glory?",
        duration: 228,
    };
    const target = {
        title: "Wonderwall",
        artist: "Oasis",
        album: "(What's the Story) Morning Glory?",
        duration: 228,
        isrc: null,
    };

    it("matches exact title + artist + album", () => {
        expect(pickBestMatch([exact], target)).toBe("w-1");
    });

    it("returns null when nothing crosses the threshold", () => {
        expect(
            pickBestMatch(
                [{ id: "x", title: "Completely Different", artist: "Nobody" }],
                target
            )
        ).toBeNull();
    });

    it("returns null for empty candidate list", () => {
        expect(pickBestMatch([], target)).toBeNull();
    });

    it("ISRC match wins over a better fuzzy candidate", () => {
        const isrcHolder: NavidromeSong = {
            id: "iso-1",
            title: "Wonderwallz",
            artist: "Oasis",
            isrc: ["USX120400001"],
        };
        expect(
            pickBestMatch([exact, isrcHolder], {
                ...target,
                isrc: "usx120400001",
            })
        ).toBe("iso-1");
    });

    it("falls back to fuzzy when no candidate carries the ISRC", () => {
        expect(
            pickBestMatch(
                [{ ...exact, isrc: ["DEAAA9900000"] }],
                { ...target, isrc: "USX120400001" }
            )
        ).toBe("w-1");
    });

    it("duration tie-breaker picks the closest length on equal scores", () => {
        const a: NavidromeSong = {
            id: "d-a",
            title: "No Signal",
            artist: "The Weeknd",
            duration: 240,
        };
        const b: NavidromeSong = {
            id: "d-b",
            title: "No Signal",
            artist: "The Weeknd",
            duration: 201,
        };
        expect(
            pickBestMatch([a, b], {
                title: "No Signal",
                artist: "The Weeknd",
                duration: 200,
                isrc: null,
            })
        ).toBe("d-b");
    });
});

describe("score helpers", () => {
    it("artistScore awards for any normalized artist-part containment", () => {
        expect(artistScore("Daft Punk", "Daft Punk")).toBe(50);
        expect(artistScore("A, B", "Solo B")).toBe(50);
        expect(artistScore("X Y Z", "Someone Else")).toBe(0);
    });

    it("albumScore awards only for exact normalized match", () => {
        expect(albumScore("Foo - Remastered", "Foo")).toBe(10);
        expect(albumScore("Foo", "Bar")).toBe(0);
        expect(albumScore(undefined, "Foo")).toBe(0);
    });
});
