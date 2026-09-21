import React from "react";
import { Pause, Volume2, Music } from "lucide-react";
import Image from "next/image";
import { api } from "@/lib/api";
import type { Track, Artist } from "../types";
import type { ColorPalette } from "@/hooks/useImageColor";
import { formatTime } from "@/utils/formatTime";
import { SectionHeader } from "@/features/home/components/SectionHeader";

interface PopularTracksProps {
    tracks: Track[];
    artist: Artist;
    colors: ColorPalette | null;
    previewTrack: string | null;
    previewPlaying: boolean;
    onPreview: (track: Track, e: React.MouseEvent) => void;
}

export const PopularTracks: React.FC<PopularTracksProps> = ({
    tracks,
    artist,
    colors: _colors,
    previewTrack,
    previewPlaying,
    onPreview,
}) => {
    return (
        <section>
            <SectionHeader color="tracks" title="Popular" />
            <div data-tv-section="tracks">
                {tracks.slice(0, 10).map((track, index) => {
                    const isPreviewPlaying =
                        previewTrack === track.id && previewPlaying;
                    const isUnowned =
                        !track.album?.id ||
                        !track.album?.title ||
                        track.album.title === "Unknown Album";
                    const coverUrl = track.album?.coverArt
                        ? api.getCoverArtUrl(track.album.coverArt, 80)
                        : null;

                    return (
                        <div
                            key={track.id}
                            data-track-row
                            data-tv-card
                            data-tv-card-index={index}
                            data-track-index={index}
                            tabIndex={0}
                            className="grid grid-cols-[40px_1fr_auto] md:grid-cols-[40px_minmax(200px,4fr)_minmax(80px,1fr)_80px] gap-4 py-2 rounded-md hover:bg-white/5 transition-colors group touch-manipulation"
                        >
                            {/* Track Number */}
                            <div className="flex items-center justify-center">
                                <span className="text-sm text-gray-400">
                                    {index + 1}
                                </span>
                            </div>

                            {/* Title + Album Art */}
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 bg-[#282828] rounded shrink-0 overflow-hidden">
                                    {coverUrl ? (
                                        <Image
                                            src={coverUrl}
                                            alt={track.title}
                                            width={40}
                                            height={40}
                                            className="object-cover"
                                            unoptimized
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                            <Music className="w-5 h-5 text-gray-600" />
                                        </div>
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-sm font-medium truncate flex items-center gap-2 text-white">
                                        <span className="truncate">
                                            {track.displayTitle ?? track.title}
                                        </span>
                                        {isUnowned && (
                                            <span className="shrink-0 text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-medium">
                                                PREVIEW
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-400 truncate">
                                        {artist.name}
                                    </p>
                                </div>
                            </div>

                            {/* Duration + Preview */}
                            <div className="hidden md:flex items-center justify-end gap-2">
                                {isUnowned && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onPreview(track, e);
                                        }}
                                        className="p-1.5 rounded-full opacity-0 group-hover:opacity-100 hover:bg-white/10 text-gray-400 hover:text-white transition-all"
                                    >
                                        {isPreviewPlaying ? (
                                            <Pause className="w-4 h-4" />
                                        ) : (
                                            <Volume2 className="w-4 h-4" />
                                        )}
                                    </button>
                                )}
                                {track.duration && (
                                    <span className="text-sm text-gray-400 w-10 text-right font-mono tabular-nums">
                                        {formatTime(track.duration)}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};
