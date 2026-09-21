"use client";

import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { useDownloadContext } from "@/lib/download-context";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { useImageColor } from "@/hooks/useImageColor";
import { api } from "@/lib/api";
import { cn } from "@/utils/cn";

// Hooks
import { useArtistData } from "@/features/artist/hooks/useArtistData";
import { useDownloadActions } from "@/features/artist/hooks/useDownloadActions";
import type { Track, Album } from "@/features/artist/types";
import { useTrackPreview } from "@/hooks/useTrackPreview";

// Components
import { ArtistHero } from "@/features/artist/components/ArtistHero";
import { ArtistBio } from "@/features/artist/components/ArtistBio";
import { PopularTracks } from "@/features/artist/components/PopularTracks";
import { Discography } from "@/features/artist/components/Discography";
import { AvailableAlbums } from "@/features/artist/components/AvailableAlbums";
import { SimilarArtists } from "@/features/artist/components/SimilarArtists";

export default function ArtistPage() {
    const router = useRouter();
    const { isPendingByMbid } = useDownloadContext();

    // Data hook
    const {
        artist,
        albums,
        loading,
        error,
        source,
        sortBy,
        setSortBy,
        reloadArtist,
    } = useArtistData();

    // Action hooks
    const { downloadArtist, downloadAlbum } = useDownloadActions();
    const { previewTrack, previewPlaying, handlePreview } = useTrackPreview();

    // Separate owned and available albums
    const ownedAlbums = albums.filter((a) => a.owned);
    const availableAlbums = albums.filter((a) => !a.owned);

    // Get image URLs for display and color extraction
    const rawImageUrl =
        artist && source === "library" ?
            artist.coverArt
        :   artist?.image || null;

    // Use a high-res image for the hero section
    const heroImage =
        rawImageUrl ? api.getCoverArtUrl(rawImageUrl, 1200) : null;

    // Use a low-res image for color extraction and background blur to save CPU
    // Include token for CORS access needed by canvas color extraction
    const lowResImage =
        rawImageUrl ? api.getCoverArtUrl(rawImageUrl, 300, true) : null;

    const { colors } = useImageColor(lowResImage || rawImageUrl);

    // Download album handler
    function handleDownloadAlbum(album: Album, e: React.MouseEvent) {
        downloadAlbum(album, artist?.name || "", e);
    }

    // Loading state
    if (loading) {
        return <LoadingScreen message="Loading artist..." />;
    }

    // Error or not found state
    if (error || !artist) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center space-y-4">
                    <div className="text-6xl text-white/20">♪</div>
                    <h1 className="text-2xl font-semibold text-white">
                        Artist Not Found
                    </h1>
                    <p className="text-neutral-400">
                        This artist isn&apos;t in your library yet.
                    </p>
                    <button
                        onClick={() => router.back()}
                        className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-white transition-colors"
                    >
                        Go Back
                    </button>
                </div>
            </div>
        );
    }

    const downloadableAlbums = albums.filter(
        (album) => album.availability !== "unavailable"
    );
    const showDownloadAll =
        source === "discovery" || downloadableAlbums.length > 0;
    const isPendingDownload = isPendingByMbid(artist.mbid || "");

    return (
        <div className="min-h-screen flex flex-col">
            <ArtistHero
                artist={artist}
                source={source}
                albums={albums}
                heroImage={heroImage}
                backgroundImage={lowResImage}
                colors={colors}
                onReload={reloadArtist}
            >
                {/* Action bar inside hero for visual continuity */}
                {showDownloadAll && (
                    <button
                        onClick={() => downloadArtist(artist)}
                        disabled={isPendingDownload}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all",
                            isPendingDownload
                                ? "bg-white/5 text-white/50 cursor-not-allowed"
                                : "bg-white/5 hover:bg-white/10 text-white/80 hover:text-white"
                        )}
                    >
                        <Download className="w-4 h-4" />
                        <span className="hidden sm:inline">
                            {isPendingDownload ? "Downloading..." : "Download All"}
                        </span>
                    </button>
                )}
            </ArtistHero>

            {/* Main Content - fills remaining viewport height */}
            <div className="relative min-h-[50vh] flex-1">
                {/* Dynamic color gradient background */}
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                        background:
                            colors ?
                                `linear-gradient(to bottom, ${colors.vibrant}15 0%, ${colors.vibrant}08 15%, ${colors.darkVibrant}05 30%, transparent 50%)`
                            :   "transparent",
                    }}
                />
                <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(16,16,16,0.4)_100%)] pointer-events-none" />

                <div className="relative px-4 md:px-8 py-6 space-y-8">
                    {/* Bio / About */}
                    {(artist.bio || artist.summary) && (
                        <ArtistBio bio={artist.bio || artist.summary || ""} />
                    )}

                    {/* Popular Tracks */}
                    {artist.topTracks && artist.topTracks.length > 0 && (
                        <PopularTracks
                            tracks={artist.topTracks}
                            artist={artist}
                            colors={colors}
                            previewTrack={previewTrack}
                            previewPlaying={previewPlaying}
                            onPreview={(track: Track, e: React.MouseEvent) =>
                                handlePreview(track, artist.name, e)
                            }
                        />
                    )}

                    {/* Discography (Owned Albums) */}
                    <Discography
                        albums={ownedAlbums}
                        colors={colors}
                        sortBy={sortBy}
                        onSortChange={setSortBy}
                    />

                    {/* Available Albums to Download */}
                    <AvailableAlbums
                        albums={availableAlbums}
                        artistName={artist.name}
                        source={source}
                        colors={colors}
                        onDownloadAlbum={handleDownloadAlbum}
                        isPendingDownload={isPendingByMbid}
                    />

                    {/* Similar Artists */}
                    {artist.similarArtists &&
                        artist.similarArtists.length > 0 && (
                            <SimilarArtists
                                similarArtists={artist.similarArtists}
                                onNavigate={(id) =>
                                    router.push(`/artist/${id}`)
                                }
                            />
                        )}
                </div>
            </div>
        </div>
    );
}
