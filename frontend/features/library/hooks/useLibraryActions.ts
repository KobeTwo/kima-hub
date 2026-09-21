import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/hooks/useQueries";

export function useLibraryActions() {
    const queryClient = useQueryClient();

    const addTrackToPlaylist = useCallback(async (playlistId: string, trackId: string) => {
        try {
            await api.addTrackToPlaylist(playlistId, trackId);
            queryClient.invalidateQueries({ queryKey: queryKeys.playlists() });
            queryClient.invalidateQueries({ queryKey: queryKeys.playlist(playlistId) });
        } catch (error) {
            console.error("Error adding track to playlist:", error);
        }
    }, [queryClient]);

    const deleteTrack = useCallback(async (id: string): Promise<void> => {
        try {
            await api.deleteTrack(id);
        } catch (error) {
            throw error;
        }
    }, []);

    const deleteAlbum = useCallback(async (id: string): Promise<void> => {
        try {
            await api.deleteAlbum(id);
        } catch (error) {
            throw error;
        }
    }, []);

    const deleteArtist = useCallback(async (id: string): Promise<void> => {
        try {
            await api.deleteArtist(id);
        } catch (error) {
            throw error;
        }
    }, []);

    return useMemo(() => ({
        addTrackToPlaylist,
        deleteTrack,
        deleteAlbum,
        deleteArtist,
    }), [
        addTrackToPlaylist,
        deleteTrack,
        deleteAlbum,
        deleteArtist,
    ]);
}
