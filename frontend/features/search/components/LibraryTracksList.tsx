"use client";

import Image from "next/image";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/utils/cn";
import { formatTime } from "@/utils/formatTime";
import type { LibraryTrack } from "../types";

interface LibraryTracksListProps {
    tracks: LibraryTrack[];
}

export function LibraryTracksList({ tracks }: LibraryTracksListProps) {
    if (!tracks || tracks.length === 0) {
        return null;
    }

    return (
        <div className="space-y-1">
            {tracks.map((track, index) => {
                const coverUrl = track.album.coverUrl
                    ? api.getCoverArtUrl(track.album.coverUrl, 48)
                    : null;

                return (
                    <div
                        key={track.id}
                        className={cn(
                            "flex items-center gap-3 p-2 rounded-md group transition-colors",
                            "hover:bg-white/5"
                        )}
                    >
                        {/* Track Number */}
                        <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                            <span className="text-sm text-gray-400">
                                {index + 1}
                            </span>
                        </div>

                        {/* Cover Art */}
                        <div className="w-10 h-10 bg-[#282828] rounded overflow-hidden flex-shrink-0">
                            {coverUrl ? (
                                <Image
                                    src={coverUrl}
                                    alt={track.album.title}
                                    width={40}
                                    height={40}
                                    className="object-cover w-full h-full"
                                    unoptimized
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <span className="text-gray-500 text-xs">
                                        ♪
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Track Info */}
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate text-white">
                                {track.title}
                            </p>
                            <p className="text-xs text-gray-400 truncate">
                                <Link
                                    href={`/artist/${
                                        track.album.artist.mbid ||
                                        track.album.artist.id
                                    }`}
                                    className="hover:underline hover:text-white"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {track.album.artist.name}
                                </Link>
                                <span className="mx-1">•</span>
                                <Link
                                    href={`/album/${track.album.id}`}
                                    className="hover:underline hover:text-white"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {track.album.title}
                                </Link>
                            </p>
                        </div>

                        {/* Duration */}
                        <span className="text-sm text-gray-400 flex-shrink-0">
                            {formatTime(track.duration)}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}
