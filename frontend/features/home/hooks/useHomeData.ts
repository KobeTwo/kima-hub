/**
 * useHomeData Hook
 *
 * Manages data loading for the Home page, fetching all 5 sections using React Query
 * and providing refresh functionality for mixes.
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import type {
    Artist,
    Mix,
    PopularArtist,
    PlaylistPreview,
} from "../types";
import {
    useRecentlyAddedQuery,
    useRecommendationsQuery,
    useMixesQuery,
    usePopularArtistsQuery,
    useRefreshMixesMutation,
    useBrowseAllQuery,
    queryKeys,
} from "@/hooks/useQueries";

export interface UseHomeDataReturn {
    // Data sections
    recentlyAdded: Artist[];
    recommended: Artist[];
    mixes: Mix[];
    popularArtists: PopularArtist[];
    featuredPlaylists: PlaylistPreview[];

    // Loading states
    isLoading: boolean;
    isRefreshingMixes: boolean;
    isBrowseLoading: boolean;

    // Actions
    handleRefreshMixes: () => Promise<void>;
}

/**
 * Custom hook to load all Home page data sections using React Query
 *
 * Loads the following sections with automatic caching:
 * 1. Recently added artists
 * 2. Recommended for you
 * 3. Mixes (Made For You)
 * 4. Popular artists
 * 5. Featured playlists
 *
 * @returns {UseHomeDataReturn} All home page data and loading states
 */
export function useHomeData(): UseHomeDataReturn {
    const { toast } = useToast();
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();

    // Listen for mixes-updated event (fired when user saves mood preferences)
    // Use refetchQueries instead of invalidateQueries to force immediate UI update
    useEffect(() => {
        const handleMixesUpdated = () => {
            // refetchQueries forces immediate refetch, unlike invalidateQueries which only marks stale
            queryClient.refetchQueries({ queryKey: queryKeys.mixes() });
        };

        window.addEventListener("mixes-updated", handleMixesUpdated);
        return () =>
            window.removeEventListener("mixes-updated", handleMixesUpdated);
    }, [queryClient]);

    // React Query hooks - these automatically handle caching, refetching, and loading states
    const { data: recentlyAddedData, isLoading: isLoadingAdded } =
        useRecentlyAddedQuery(10);
    const { data: recommendedData, isLoading: isLoadingRecommended } =
        useRecommendationsQuery(10);
    const { data: mixesData, isLoading: isLoadingMixes } = useMixesQuery();
    const { data: popularData, isLoading: isLoadingPopular } =
        usePopularArtistsQuery(20);
    const { data: browseData, isLoading: isBrowseLoading } =
        useBrowseAllQuery();

    // Mutation for refreshing mixes
    const { mutateAsync: refreshMixes, isPending: isRefreshingMixes } =
        useRefreshMixesMutation();

    /**
     * Refresh mixes and update cache
     */
    const handleRefreshMixes = async () => {
        try {
            await refreshMixes();
            toast.success("Mixes refreshed! Check out your new daily picks");
        } catch (error) {
            console.error("Failed to refresh mixes:", error);
            toast.error("Failed to refresh mixes");
        }
    };

    // Calculate overall loading state - true if any query is loading
    const isLoading =
        !isAuthenticated ||
        isLoadingAdded ||
        isLoadingRecommended ||
        isLoadingMixes ||
        isLoadingPopular;

    return {
        recentlyAdded: recentlyAddedData?.artists || [],
        recommended: recommendedData?.artists || [],
        mixes: Array.isArray(mixesData) ? mixesData : [],
        popularArtists: popularData?.artists || [],
        featuredPlaylists: browseData?.playlists || [],
        isLoading,
        isRefreshingMixes,
        isBrowseLoading,
        handleRefreshMixes,
    };
}
