"use client";

import { useMemo } from "react";
import { Download, CheckCircle, Music } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/utils/cn";
import { formatTime } from "@/utils/formatTime";
import { getQualityBadge, parseFilename } from "./soulseekHelpers";
import type { LibraryTrack, SoulseekResult } from "../types";

interface UnifiedSongsListProps {
    tracks: LibraryTrack[];
    soulseekResults: SoulseekResult[];
    downloadingFiles: Set<string>;
    onDownload: (result: SoulseekResult) => void;
    maxTotal?: number;
    maxLibrary?: number;
}

function sortByQuality(a: SoulseekResult, b: SoulseekResult): number {
    const scoreA = a.format === "flac" ? 10000 : a.bitrate;
    const scoreB = b.format === "flac" ? 10000 : b.bitrate;
    return scoreB - scoreA;
}

export function UnifiedSongsList({
    tracks,
    soulseekResults,
    downloadingFiles,
    onDownload,
    maxTotal = 6,
    maxLibrary = 4,
}: UnifiedSongsListProps) {
    const librarySlice = tracks.slice(0, maxLibrary);
    const soulseekSlots = maxTotal - librarySlice.length;
    const soulseekSlice = useMemo(
        () =>
            [...soulseekResults]
                .sort(sortByQuality)
                .slice(0, Math.max(0, soulseekSlots)),
        [soulseekResults, soulseekSlots],
    );

    if (librarySlice.length === 0 && soulseekSlice.length === 0) {
        return null;
    }

    return (
        <div className="space-y-1">
            {/* Library tracks */}
            {librarySlice.map((track, index) => {
                const coverUrl = track.album.coverUrl
                    ? api.getCoverArtUrl(track.album.coverUrl, 48)
                    : null;

                return (
                    <div
                        key={track.id}
                        className={cn(
                            "flex items-center gap-3 p-2 rounded-md group transition-colors",
                            "hover:bg-white/5",
                        )}
                    >
                        <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                            <span className="text-sm text-gray-400">
                                {index + 1}
                            </span>
                        </div>

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
                                    <span className="text-gray-500 text-xs">&#9834;</span>
                                </div>
                            )}
                        </div>

                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate text-white">
                                {track.title}
                            </p>
                            <p className="text-xs text-gray-400 truncate">
                                <Link
                                    href={`/artist/${track.album.artist.id}`}
                                    className="hover:underline hover:text-white"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {track.album.artist.name}
                                </Link>
                                <span className="mx-1">&bull;</span>
                                <Link
                                    href={`/album/${track.album.id}`}
                                    className="hover:underline hover:text-white"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {track.album.title}
                                </Link>
                            </p>
                        </div>

                        <span className="text-sm text-gray-400 flex-shrink-0">
                            {formatTime(track.duration)}
                        </span>
                    </div>
                );
            })}

            {/* Soulseek results */}
            {soulseekSlice.map((result, index) => {
                const parsed = result.parsedArtist
                    ? {
                          artist: result.parsedArtist,
                          title:
                              result.filename
                                  .split("\\")
                                  .pop()
                                  ?.split(" - ")
                                  .slice(1)
                                  .join(" - ") || result.filename,
                      }
                    : parseFilename(result.filename);
                const downloadKey = `${result.username}:${result.path}`;
                const isDownloading = downloadingFiles.has(downloadKey);

                return (
                    <div
                        key={`slsk-${result.username}-${result.filename}-${index}`}
                        className="flex items-center gap-3 p-2 rounded-md hover:bg-white/5 transition-colors"
                    >
                        <button
                            onClick={() => !isDownloading && onDownload(result)}
                            disabled={isDownloading}
                            className="w-8 h-8 flex items-center justify-center flex-shrink-0"
                        >
                            {isDownloading ? (
                                <CheckCircle className="w-4 h-4 text-green-400" />
                            ) : (
                                <Download className="w-4 h-4 text-brand" />
                            )}
                        </button>

                        <div className="w-10 h-10 bg-[#181818] rounded flex items-center justify-center flex-shrink-0">
                            <Music className="w-5 h-5 text-gray-400" />
                        </div>

                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">
                                {parsed.title}
                            </p>
                            <p className="text-xs text-gray-400 truncate">
                                {parsed.artist}
                            </p>
                        </div>

                        <div className="flex-shrink-0">
                            {getQualityBadge(result)}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
