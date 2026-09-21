import { useCallback } from "react";
import { useToast } from "@/lib/toast-context";
import { api } from "@/lib/api";
import { DiscoverTrack } from "../types";

export function useDiscoverActions(
    onGenerationComplete?: () => void,
    isGenerating?: boolean,
    refreshBatchStatus?: () => Promise<unknown>,
    setPendingGeneration?: (pending: boolean) => void,
    markGenerationStart?: () => void,
    updateTrackLiked?: (albumId: string, isLiked: boolean) => void
) {
    const { toast } = useToast();

    const handleGenerate = useCallback(async () => {
        if (isGenerating) {
            console.warn("Generation already in progress, ignoring request");
            toast.warning("Generation already in progress...");
            return;
        }

        // Set optimistic state immediately to prevent double-clicks
        setPendingGeneration?.(true);
        markGenerationStart?.();

        try {
            await api.generateDiscoverWeekly();

            // Immediately refresh batch status to start polling
            if (refreshBatchStatus) {
                await refreshBatchStatus();
            }

            toast.success("Generation started! Downloading albums...");
        } catch (error: unknown) {
            console.error("Generation failed:", error);
            // Clear pending state on error
            setPendingGeneration?.(false);
            const err = error as Error & { status?: number };
            if (err.status === 409) {
                toast.warning("A playlist is already being generated...");
                // Refresh status in case UI is out of sync
                if (refreshBatchStatus) {
                    await refreshBatchStatus();
                }
            } else {
                toast.error(err.message || "Failed to generate playlist");
            }
        }
    }, [toast, isGenerating, refreshBatchStatus, setPendingGeneration, markGenerationStart]);

    const handleLike = useCallback(
        async (track: DiscoverTrack) => {
            const newLikedState = !track.isLiked;

            // Optimistically update UI immediately
            updateTrackLiked?.(track.albumId, newLikedState);

            try {
                if (track.isLiked) {
                    await api.unlikeDiscoverAlbum(track.albumId);
                    toast.success(`Unmarked ${track.album}`);
                } else {
                    await api.likeDiscoverAlbum(track.albumId);
                    toast.success(`${track.album} will be kept!`);
                }

                // Reload to sync with server state
                onGenerationComplete?.();
            } catch (error: unknown) {
                console.error("Like failed:", error);
                // Revert optimistic update on error
                updateTrackLiked?.(track.albumId, track.isLiked);
                toast.error(error instanceof Error ? error.message : "Failed to update");
            }
        },
        [toast, onGenerationComplete, updateTrackLiked]
    );

    return {
        handleGenerate,
        handleLike,
    };
}
