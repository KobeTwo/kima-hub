export interface NavidromeSong {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  isrc?: string[];
  duration?: number;
}

export interface RgCoverInfo {
  isrcs: string[];
  artists: string[];
  album: string;
  coverPath: string;
  totalTracks: number;
}

const SUFFIX_PATTERNS: RegExp[] = [
  /\s*-\s*(\d{4}\s*)?remaster(?:ed)?\s*$/i,
  /\s*-\s*remaster(?:ed)?\s*\d{4}\s*$/i,
  /\s*-\s*(deluxe|expanded|anniversary|special)\s+edition\s*$/i,
  /\s*-\s*(mono|stereo)\s+version\s*$/i,
  /\s*-\s*\d{4}\s+version\s*$/i,
  /\s*-\s*version\s*$/i,
  /\s*-\s*(radio|album|single)\s+edit\s*$/i,
];

function stripCommonSuffixes(s: string): string {
  let out = (s || "").trim();
  for (const pattern of SUFFIX_PATTERNS) {
    out = out.replace(pattern, "");
  }
  return out.trim();
}

function stripAccents(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeForMatch(title: string, artist?: string): string {
  let s = stripAccents(stripCommonSuffixes(title));
  s = s.toLowerCase();
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/\b(feat|ft)\.?\b.*$/g, " ");
  if (artist) {
    const a = normalizeForMatch(artist);
    if (a && s.startsWith(`${a} - `)) {
      s = s.slice(a.length + 3);
    }
  }
  s = s.replace(/^[a-z0-9]+ - /, "");
  s = s.replace(/[^a-z0-9]+/g, " ");
  s = s.replace(/\s+/g, " ");
  return s.trim();
}

export function isRgCoverSameRelease(isrcs: string[], songIsrcs: string[] | undefined): boolean {
  if (!isrcs || !isrcs.length || !songIsrcs || !songIsrcs.length) {
    return false;
  }
  const release = new Set(
    isrcs.map((v) => (v || "").trim().toUpperCase()).filter(Boolean),
  );
  if (release.size === 0) {
    return false;
  }
  for (const v of songIsrcs.map((x) => (x || "").trim().toUpperCase())) {
    if (v && release.has(v)) {
      return true;
    }
  }
  return false;
}

export function splitArtists(s: string): string[] {
  const text = (s || "").replace(/\(([^)]*)\)/g, " $1 ");
  const parts = text
    .split(/[,;\/&]|\bfeat\.?|\bft\.?/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(part);
    }
  }
  return out;
}

export function buildSearchQueries(title: string, artist: string): string[] {
  const t = normalizeForMatch(title);
  const artists = splitArtists(artist);
  const firstArtist = artists.length > 0 ? normalizeForMatch(artists[0]) : normalizeForMatch(artist);

  const queries: string[] = [];
  if (t && firstArtist) {
    queries.push(`${t} ${firstArtist}`);
  }
  if (t && !queries.includes(t)) {
    queries.push(t);
  }
  if (firstArtist && !queries.includes(firstArtist)) {
    queries.push(firstArtist);
  }
  return queries;
}

const MATCH_THRESHOLD = 70;
const DURATION_TOLERANCE_SECONDS = 4;

function normalizeIsrcs(isrcs: string[] | undefined): Set<string> {
  return new Set((isrcs ?? []).map((v) => v.trim().toUpperCase()).filter(Boolean));
}

function durationDelta(song: NavidromeSong, targetDuration: number): number {
  return Math.abs((song.duration ?? 0) - targetDuration);
}

function pickIsrcWinner(
  songs: NavidromeSong[],
  targetIsrcs: Set<string>,
  targetDuration: number,
): NavidromeSong | null {
  const candidates = songs.filter((song) => {
    const songIsrcs = normalizeIsrcs(song.isrc);
    for (const isrc of songIsrcs) {
      if (targetIsrcs.has(isrc)) {
        return true;
      }
    }
    return false;
  });

  if (candidates.length === 0) {
    return null;
  }

  let best = candidates[0];
  let bestDelta = durationDelta(candidates[0], targetDuration);
  for (const song of candidates.slice(1)) {
    const delta = durationDelta(song, targetDuration);
    if (delta < bestDelta) {
      best = song;
      bestDelta = delta;
    }
  }
  return best;
}

export function pickBestMatch(
  songs: NavidromeSong[],
  target: { title: string; artist?: string; duration?: number; isrcs?: string[] },
): NavidromeSong | null {
  if (!songs.length) {
    return null;
  }

  const targetDuration = target.duration ?? 0;

  const targetIsrcs = normalizeIsrcs(target.isrcs);
  if (targetIsrcs.size > 0) {
    const isrcWinner = pickIsrcWinner(songs, targetIsrcs, targetDuration);
    if (isrcWinner) {
      return isrcWinner;
    }
  }

  const targetTitle = normalizeForMatch(target.title);
  const targetArtists = target.artist
    ? splitArtists(target.artist).map((a) => normalizeForMatch(a))
    : [];

  let best: NavidromeSong | null = null;
  let bestScore = 0;
  let bestDelta = 0;

  for (const song of songs) {
    const title = normalizeForMatch(song.title);
    const artist = normalizeForMatch(song.artist);

    if (!song.id || !title) {
      continue;
    }

    let score = 0;

    if (title === targetTitle) {
      score += 100;
    } else if (targetTitle && (targetTitle.includes(title) || title.includes(targetTitle))) {
      score += 60;
    }

    if (targetArtists.length > 0) {
      if (targetArtists.some((a) => a && (artist.includes(a) || a.includes(artist)))) {
        score += 50;
      }
    }

    const delta = durationDelta(song, targetDuration);
    if (delta <= DURATION_TOLERANCE_SECONDS) {
      score += 20;
    }

    if (score > bestScore || (best !== null && score === bestScore && delta < bestDelta)) {
      best = song;
      bestScore = score;
      bestDelta = delta;
    }
  }

  if (bestScore < MATCH_THRESHOLD) {
    return null;
  }
  return best;
}
