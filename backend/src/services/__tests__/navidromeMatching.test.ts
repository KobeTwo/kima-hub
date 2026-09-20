import {
  normalizeForMatch,
  isRgCoverSameRelease,
  splitArtists,
  buildSearchQueries,
  pickBestMatch,
  NavidromeSong,
} from "../navidromeMatching";

describe("normalizeForMatch", () => {
  it("lowercases and strips brackets", () => {
    expect(normalizeForMatch("Song (Remastered 2021)")).toBe("song");
    expect(normalizeForMatch("Song [Deluxe]")).toBe("song");
  });

  it("removes common suffixes", () => {
    expect(normalizeForMatch("Song (Live)")).toBe("song");
    expect(normalizeForMatch("Song (Remaster)")).toBe("song");
  });

  it("strips leading single word + ' by ' pattern", () => {
    expect(normalizeForMatch("Artist - Song")).toBe("song");
    expect(normalizeForMatch("Artist - Song (feat. Someone)")).toBe("song");
  });

  it("collapses whitespace", () => {
    expect(normalizeForMatch("  Hello   World  ")).toBe("hello world");
  });
});

describe("isRgCoverSameRelease", () => {
  it("returns true when ISRCs overlap", () => {
    expect(isRgCoverSameRelease(["USX120400001", "USX120400002"], ["USX120400002", "USX120400003"])).toBe(true);
  });

  it("returns false when no ISRC overlap", () => {
    expect(isRgCoverSameRelease(["AAA"], ["BBB"])).toBe(false);
  });

  it("returns false when either list is empty", () => {
    expect(isRgCoverSameRelease([], ["BBB"])).toBe(false);
    expect(isRgCoverSameRelease(["AAA"], [])).toBe(false);
    expect(isRgCoverSameRelease([], [])).toBe(false);
  });
});

describe("splitArtists", () => {
  it("splits on comma, feat., ft.", () => {
    expect(splitArtists("Artist A, Artist B")).toEqual(["Artist A", "Artist B"]);
    expect(splitArtists("A (feat. B)")).toEqual(["A", "B"]);
  });

  it("trims and deduplicates", () => {
    expect(splitArtists("  A ,  A  ")).toEqual(["A"]);
  });
});

describe("buildSearchQueries", () => {
  it("returns title-artist first, then title", () => {
    const queries = buildSearchQueries("Wonderwall", "Oasis");
    expect(queries[0]).toBe("wonderwall oasis");
    expect(queries[1]).toBe("wonderwall");
  });

  it("handles multiple artists", () => {
    const queries = buildSearchQueries("Song", "Artist A, Artist B");
    expect(queries[0]).toBe("song artist a");
    expect(queries[1]).toBe("song");
  });

  it("returns [] for empty input", () => {
    expect(buildSearchQueries("", "A")).toEqual(["a"]);
  });
});

describe("pickBestMatch", () => {
  const target = { title: "Wonderwall", artist: "Oasis", duration: 228 };

  it("returns null for empty list", () => {
    expect(pickBestMatch([], target)).toBeNull();
  });

  it("prefers exact ISRC match", () => {
    const songs: NavidromeSong[] = [
      { id: "1", title: "Wonderwall", artist: "Oasis", isrc: ["USX120400001"], duration: 228 },
      { id: "2", title: "Wonderwall", artist: "Oasis", isrc: ["ZZZ999"], duration: 230 },
    ];
    const result = pickBestMatch(songs, { ...target, isrcs: ["USX120400001"] });
    expect(result?.id).toBe("1");
  });

  it("scores by title+artist+duration", () => {
    const songs: NavidromeSong[] = [
      { id: "1", title: "Wonderwall", artist: "Other Artist", duration: 228 },
      { id: "2", title: "Wonderwall", artist: "Oasis", duration: 228 },
    ];
    const result = pickBestMatch(songs, target);
    expect(result?.id).toBe("2");
  });

  it("returns null when no candidate reaches threshold", () => {
    const songs: NavidromeSong[] = [
      { id: "1", title: "Completely Different", artist: "Nobody", duration: 100 },
    ];
    expect(pickBestMatch(songs, target)).toBeNull();
  });
});
