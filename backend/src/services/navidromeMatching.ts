/**
 * Pure matching utilities for mapping Kima tracks to Navidrome songs.
 * Port of the proven matching from usenet/spotify_importer/app.py.
 * No I/O — unit-testable in isolation.
 */

export interface NavidromeSong {
    id: string;
    title: string;
    artist?: string;
    album?: string;
    duration?: number;
    isrc?: string[];
}

export interface MatchTarget {
    title: string;
    artist: string;
    album?: string;
    duration?: number;
    isrc?: string | null;
}

export function stripCommonSuffixes(s: string): string {
    let out = (s || "").trim();
    out = out.replace(/\s*-\s*(\d{4}\s*)?remaster(?:ed)?\s*$/i, "");
    out = out.replace(/\s*-\s*remaster(?:ed)?\s*\d{4}\s*$/i, "");
    out = out.replace(
        /\s*-\s*(?:\d{4}\s+)?(deluxe|expanded|anniversary|special)\s+edition\s*$/i,
        ""
    );
    out = out.replace(/\s*-\s*(mono|stereo)\s+version\s*$/i, "");
    out = out.replace(/\s*-\s*\d{4}\s+version\s*$/i, "");
    out = out.replace(/\s*-\s*version\s*$/i, "");
    out = out.replace(/\s*-\s*(radio|album|single)\s+edit\s*$/i, "");
    return out.trim();
}

export function cleanForSearch(s: string): string {
    let out = stripCommonSuffixes(s);
    out = out.replace(/\([^)]*\)/g, " ");
    out = out.replace(/\[[^\]]*\]/g, " ");
    out = out.replace(/\b(feat|ft)\.?\b.*$/i, " ");
    out = out.replace(/\s+/g, " ");
    return out.trim();
}

export function normalizeName(s: string): string {
    let out = stripCommonSuffixes(s || "").toLowerCase().trim();
    out = out.replace(/\([^)]*\)/g, " ");
    out = out.replace(/\[[^\]]*\]/g, " ");
    out = out.replace(/\b(feat|ft)\.?\b.*$/i, " ");
    out = out.replace(/[^a-z0-9]+/g, " ");
    out = out.replace(/\s+/g, " ");
    return out.trim();
}

export function splitArtists(s: string): string[] {
    return (s || "")
        .split(/,|;|\/|&|\sfeat\.?|\sft\.?/i)
        .map((p) => p.trim())
        .filter(Boolean);
}

export function buildSearchQueries(title: string, artist: string): string[] {
    const titleClean = cleanForSearch(title);
    const artistsClean = cleanForSearch(artist);
    const split = splitArtists(artistsClean);
    const firstArtist = split[0] || artistsClean;

    const queries: string[] = [];
    if (titleClean && artistsClean) {
        queries.push(`${titleClean} ${artistsClean}`.trim());
    }
    if (titleClean && firstArtist && firstArtist !== artistsClean) {
        queries.push(`${titleClean} ${firstArtist}`.trim());
    }
    if (titleClean) {
        queries.push(titleClean);
    }

    const rawCombo = `${title} ${artist}`.trim();
    if (rawCombo && !queries.includes(rawCombo)) {
        queries.push(rawCombo);
    }
    if (title && !queries.includes(title)) {
        queries.push(title);
    }

    const seen = new Set<string>();
    const out: string[] = [];
    for (const q of queries) {
        const t = q.trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
    }
    return out;
}

function titleScore(targetTitle: string, candidateTitle: string): number {
    const t = normalizeName(targetTitle);
    const c = normalizeName(candidateTitle);
    if (!t || !c) return 0;
    if (t === c) return 100;
    if (t.includes(c) || c.includes(t)) return 60;
    return 0;
}

export function artistScore(targetArtist: string, candidateArtist: string): number {
    const targetParts = splitArtists(targetArtist)
        .map(normalizeName)
        .filter(Boolean);
    const c = normalizeName(candidateArtist);
    if (targetParts.length === 0 || !c) return 0;
    return targetParts.some((a) => c.includes(a) || a.includes(c)) ? 50 : 0;
}

export function albumScore(
    targetAlbum: string | undefined,
    candidateAlbum: string | undefined
): number {
    if (!targetAlbum || !candidateAlbum) return 0;
    const t = normalizeName(targetAlbum);
    const c = normalizeName(candidateAlbum);
    return t && c && t === c ? 10 : 0;
}

const MATCH_THRESHOLD = 70;

/**
 * Pick the best Navidrome song for a Kima track.
 * 1) ISRC exact match within the candidates wins outright (globally unique).
 * 2) Otherwise best fuzzy score (>= threshold); equal scores resolved by
 *    closest duration.
 * Returns the song id or null.
 */
export function pickBestMatch(
    songs: NavidromeSong[],
    target: MatchTarget
): string | null {
    if (!songs || songs.length === 0) return null;

    const targetIsrc = (target.isrc || "").trim().toUpperCase();
    if (targetIsrc) {
        for (const s of songs) {
            const isrcs = (s.isrc || []).map((x) => (x || "").trim().toUpperCase());
            if (isrcs.includes(targetIsrc)) return s.id;
        }
    }

    let best: { score: number; durationDelta: number; id: string } | null =
        null;
    for (const s of songs) {
        const score =
            titleScore(target.title, s.title) +
            artistScore(target.artist, s.artist || "") +
            albumScore(target.album, s.album);
        if (score < MATCH_THRESHOLD) continue;

        let durationDelta = 0;
        if (target.duration && s.duration) {
            durationDelta = Math.abs(target.duration - s.duration);
        }

        if (
            !best ||
            score > best.score ||
            (score === best.score && durationDelta < best.durationDelta)
        ) {
            best = { score, durationDelta, id: s.id };
        }
    }
    return best ? best.id : null;
}
