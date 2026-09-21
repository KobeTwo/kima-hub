import { Heart, Music } from "lucide-react";
import Image from "next/image";
import { cn } from "@/utils/cn";
import { DiscoverTrack } from "../types";
import { api } from "@/lib/api";
import { formatTime } from "@/utils/formatTime";
import { tierColors, tierLabels } from "../constants";

interface TrackListProps {
    tracks: DiscoverTrack[];
    onLike: (track: DiscoverTrack) => void;
}

export function TrackList({
    tracks,
    onLike,
}: TrackListProps) {
    return (
        <div className="w-full">
            {/* Table Header */}
            <div className="hidden md:grid grid-cols-[40px_minmax(200px,4fr)_minmax(100px,2fr)_80px_80px] gap-4 px-4 py-2 text-xs text-gray-400 uppercase tracking-wider border-b border-white/10 mb-2">
                <span className="text-center">#</span>
                <span>Title</span>
                <span>Album</span>
                <span className="text-center">Match</span>
                <span className="text-right">Duration</span>
            </div>

            {/* Track Rows */}
            <div>
                {tracks.map((track, index) => {
                    return (
                        <div
                            key={track.id}
                            className={cn(
                                "grid grid-cols-[40px_1fr_auto] md:grid-cols-[40px_minmax(200px,4fr)_minmax(100px,2fr)_80px_80px] gap-4 px-4 py-2 rounded-md hover:bg-white/5 transition-colors group touch-manipulation"
                            )}
                        >
                            {/* Track Number */}
                            <div className="flex items-center justify-center">
                                <span className="text-sm text-gray-400">
                                    {index + 1}
                                </span>
                            </div>

                            {/* Title + Artist */}
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 bg-[#282828] rounded shrink-0 overflow-hidden">
                                    {track.coverUrl ? (
                                        <Image
                                            src={api.getCoverArtUrl(
                                                track.coverUrl,
                                                80
                                            )}
                                            alt={track.album}
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
                                    <p className="text-sm font-medium truncate text-white">
                                        {track.title}
                                    </p>
                                    <p className="text-xs text-gray-400 truncate">
                                        {track.artist}
                                    </p>
                                </div>
                            </div>

                            {/* Album (hidden on mobile) */}
                            <p className="hidden md:flex items-center text-sm text-gray-400 truncate">
                                {track.album}
                            </p>

                            {/* Tier Badge (hidden on mobile) */}
                            <div className="hidden md:flex items-center justify-center">
                                <span
                                    className={cn(
                                        "px-2 py-0.5 rounded-full text-xs font-medium bg-white/5",
                                        tierColors[track.tier]
                                    )}
                                >
                                    {tierLabels[track.tier]?.split(" ")[0]}
                                </span>
                            </div>

                            {/* Duration + Like */}
                            <div className="flex items-center justify-end gap-2">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onLike(track);
                                    }}
                                    className={cn(
                                        "p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-all",
                                        track.isLiked
                                            ? "text-[#a855f7] hover:text-[#9333ea]"
                                            : "text-gray-400 hover:text-white"
                                    )}
                                    title={
                                        track.isLiked
                                            ? "Unlike"
                                            : "Keep in library"
                                    }
                                >
                                    <Heart
                                        className={cn(
                                            "w-4 h-4",
                                            track.isLiked && "fill-current"
                                        )}
                                    />
                                </button>
                                <span className="text-sm text-gray-400 w-10 text-right">
                                    {formatTime(track.duration)}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
