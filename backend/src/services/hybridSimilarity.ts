export interface SimilarTrack {
    id: string;
    title: string;
    distance: number;
    similarity: number;
    albumId: string;
    albumTitle: string;
    albumCoverUrl: string | null;
    artistId: string;
    artistName: string;
}

export async function findSimilarTracks(
    trackId: string,
    limit: number = 20,
    userId?: string
): Promise<SimilarTrack[]> {
    return [];
}