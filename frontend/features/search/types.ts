export type FilterTab = "all" | "library" | "discover" | "soulseek";

export interface Artist {
    id: string;
    name: string;
    heroUrl?: string;
    mbid?: string;
    image?: string;
}

export interface Album {
    id: string;
    title: string;
    coverUrl?: string;
    albumId?: string;
    artist?: {
        name: string;
    };
}

export interface LibraryTrack {
    id: string;
    title: string;
    duration: number;
    discNumber?: number | null;
    discSubtitle?: string | null;
    album: {
        id: string;
        title: string;
        coverUrl?: string | null;
        artist: {
            id: string;
            mbid?: string;
            name: string;
        };
    };
    // Metadata override fields
    displayTitle?: string | null;
    displayTrackNo?: number | null;
    hasUserOverrides?: boolean;
}

export interface SearchResult {
    artists?: Artist[];
    albums?: Album[];
    tracks?: LibraryTrack[];
}

export interface DiscoverResult {
    type: "music";
    id?: string;
    name: string;
    mbid?: string;
    image?: string;
    listeners?: number;
}

export interface AliasInfo {
    original: string;
    canonical: string;
    mbid?: string;
}

export interface SoulseekResult {
    username: string;
    path: string;
    filename: string;
    size: number;
    bitrate: number;
    format: string;
    parsedArtist?: string;
    parsedAlbum?: string;
    parsedTitle?: string;
}

export type SoulseekSortField = "quality" | "bitrate" | "size" | "filename";
export type SoulseekViewMode = "flat" | "grouped";
export type SoulseekFormatFilter = "all" | "flac" | "320" | "256";
