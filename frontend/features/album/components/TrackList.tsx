import React, { memo, useMemo, useCallback } from "react";
import { Card } from "@/components/ui/Card";
import { Pause, Plus, Volume2 } from "lucide-react";
import { cn } from "@/utils/cn";
import type { Track, Album, AlbumSource } from "../types";
import { formatTime } from "@/utils/formatTime";

interface TrackListProps {
    tracks: Track[];
    album: Album;
    source: AlbumSource;
    onAddToPlaylist: (trackId: string) => void;
    previewTrack: string | null;
    previewPlaying: boolean;
    onPreview: (track: Track, e: React.MouseEvent) => void;
}

interface TrackRowProps {
    track: Track;
    index: number;
    album: Album;
    isOwned: boolean;
    isPreviewPlaying: boolean;
    onAddToPlaylist: (trackId: string) => void;
    onPreview: (track: Track, e: React.MouseEvent) => void;
}

const TrackRow = memo(
    function TrackRow({
        track,
        index,
        album,
        isOwned,
        isPreviewPlaying,
        onAddToPlaylist,
        onPreview,
    }: TrackRowProps) {
        const isMissingTrack = !!track.isMissing;
        const isPreviewOnly = !isOwned || isMissingTrack;
        const displayTrackNumber =
            typeof track.trackNumber === "number" ? track.trackNumber : index + 1;

        const handleAddToPlaylist = useCallback(
            (e: React.MouseEvent) => {
                e.stopPropagation();
                onAddToPlaylist(track.id);
            },
            [track.id, onAddToPlaylist]
        );

        const handlePreview = useCallback(
            (e: React.MouseEvent) => {
                e.stopPropagation();
                onPreview(track, e);
            },
            [track, onPreview]
        );

        return (
            <div
                data-track-row
                data-tv-card
                data-tv-card-index={index}
                tabIndex={0}
                className={cn(
                    "group relative flex items-center gap-3 md:gap-4 px-3 md:px-4 py-3 hover:bg-[var(--bg-tertiary)] transition-colors touch-manipulation",
                    isPreviewOnly && "opacity-70 hover:opacity-90"
                )}
            >
                <div className="w-6 md:w-8 flex-shrink-0 text-center">
                    <span className="text-sm text-gray-500">
                        {displayTrackNumber}
                    </span>
                </div>

                <div className="flex-1 min-w-0">
                    <div className="text-sm md:text-base flex items-center gap-2 text-white">
                        <span className="truncate">
                            {track.displayTitle ?? track.title}
                        </span>
                        {isMissingTrack && (
                            <span className="shrink-0 text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/30 font-medium">
                                MISSING
                            </span>
                        )}
                        {isPreviewOnly && (
                            <span className="shrink-0 text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/30 font-medium">
                                PREVIEW
                            </span>
                        )}
                    </div>
                    {track.artist?.name &&
                        track.artist.name !== album.artist?.name && (
                            <div className="text-xs md:text-sm text-gray-400 truncate">
                                {track.artist.name}
                            </div>
                        )}
                </div>

                {isOwned && !isMissingTrack && (
                    <button
                        onClick={handleAddToPlaylist}
                        className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-2 hover:bg-[#2a2a2a] rounded-full transition-all text-gray-400 hover:text-white"
                        aria-label="Add to playlist"
                        title="Add to playlist"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                )}

                {isPreviewOnly ? (
                    <button
                        onClick={handlePreview}
                        className="p-2 rounded-full bg-[var(--bg-hover)] hover:bg-[#2a2a2a] transition-colors text-white"
                        aria-label={
                            isPreviewPlaying ? "Pause preview" : "Play preview"
                        }
                    >
                        {isPreviewPlaying ? (
                            <Pause className="w-4 h-4" />
                        ) : (
                            <Volume2 className="w-4 h-4" />
                        )}
                    </button>
                ) : null}

                {track.duration && (
                    <div className="text-xs md:text-sm text-gray-400 w-10 md:w-12 text-right font-mono tabular-nums">
                        {formatTime(track.duration)}
                    </div>
                )}
            </div>
        );
    },
    (prevProps, nextProps) => {
        return (
            prevProps.track.id === nextProps.track.id &&
            prevProps.isPreviewPlaying === nextProps.isPreviewPlaying &&
            prevProps.index === nextProps.index &&
            prevProps.isOwned === nextProps.isOwned
        );
    }
);

export const TrackList = memo(function TrackList({
    tracks,
    album,
    source,
    onAddToPlaylist,
    previewTrack,
    previewPlaying,
    onPreview,
}: TrackListProps) {
    const isOwned = source === "library";
    const discNumbers = useMemo(
        () =>
            Array.from(
                new Set(
                    tracks
                        .map((track) => track.discNumber)
                        .filter((disc) => disc != null)
                )
            ),
        [tracks]
    );
    const shouldGroupByDisc = discNumbers.length > 1;

    return (
        <section>
            <Card>
                <div
                    data-tv-section="tracks"
                    className="divide-y divide-[#1c1c1c]"
                >
                    {tracks.map((track, index) => {
                        const isPreviewPlaying =
                            previewTrack === track.id && previewPlaying;
                        const discNumber = track.discNumber ?? 1;
                        const previousDiscNumber =
                            index > 0 ? tracks[index - 1]?.discNumber ?? 1 : null;
                        const showDiscHeader =
                            shouldGroupByDisc &&
                            (index === 0 || discNumber !== previousDiscNumber);
                        const discLabel = track.discSubtitle?.trim();

                        return (
                            <React.Fragment key={track.id}>
                                {showDiscHeader && (
                                    <div className="px-3 md:px-4 py-2 text-xs font-semibold tracking-wide text-gray-400 uppercase bg-[#121212]">
                                        Disc {discNumber}
                                        {discLabel ? ` -- ${discLabel}` : ""}
                                    </div>
                                )}
                                <TrackRow
                                    track={track}
                                    index={index}
                                    album={album}
                                    isOwned={isOwned}
                                    isPreviewPlaying={isPreviewPlaying}
                                    onAddToPlaylist={onAddToPlaylist}
                                    onPreview={onPreview}
                                />
                            </React.Fragment>
                        );
                    })}
                </div>
            </Card>
        </section>
    );
});
