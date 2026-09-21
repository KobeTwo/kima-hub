"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { Music, Github } from "lucide-react";
import { formatTime, formatDuration } from "@/utils/formatTime";

interface ShareTrack {
    id: string;
    title: string;
    duration: number;
    trackNo?: number;
    discNumber?: number | null;
    discSubtitle?: string | null;
    album?: {
        title: string;
        coverUrl?: string;
        artist?: {
            name: string;
        };
    };
}

interface ShareData {
    entityType: "playlist" | "track" | "album";
    entity: {
        id: string;
        name?: string;
        title?: string;
        coverUrl?: string;
        items?: { track: ShareTrack }[];
        tracks?: ShareTrack[];
        artist?: { name: string };
        album?: { title: string; coverUrl?: string; artist?: { name: string } };
        duration?: number;
    };
    createdAt: string;
}

function getCoverUrl(shareData: ShareData): string | null {
    const entity = shareData.entity;
    if (shareData.entityType === "playlist") {
        const firstItem = entity.items?.[0];
        return firstItem?.track?.album?.coverUrl || null;
    }
    if (shareData.entityType === "album") {
        return entity.coverUrl || null;
    }
    if (shareData.entityType === "track") {
        return entity.album?.coverUrl || null;
    }
    return null;
}

function getTracksFromEntity(shareData: ShareData): ShareTrack[] {
    const entity = shareData.entity;
    if (shareData.entityType === "playlist") {
        return entity.items?.map((item) => item.track).filter(Boolean) || [];
    }
    if (shareData.entityType === "album") {
        return entity.tracks || [];
    }
    if (shareData.entityType === "track") {
        return [
            {
                id: entity.id,
                title: entity.title || entity.name || "Unknown Track",
                duration: entity.duration || 0,
                album: entity.album,
            },
        ];
    }
    return [];
}

function getEntityTitle(shareData: ShareData): string {
    return shareData.entity.name || shareData.entity.title || "Shared Content";
}

function getEntitySubtitle(shareData: ShareData): string {
    if (shareData.entityType === "playlist") {
        const count = shareData.entity.items?.length || 0;
        return `${count} track${count !== 1 ? "s" : ""}`;
    }
    if (shareData.entityType === "album") {
        return shareData.entity.artist?.name || "Unknown Artist";
    }
    if (shareData.entityType === "track") {
        return shareData.entity.album?.artist?.name || "Unknown Artist";
    }
    return "";
}

export default function SharePageClient() {
    const params = useParams();
    const token = params.token as string;

    const [data, setData] = useState<ShareData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`/api/share/${token}`)
            .then(async (res) => {
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(
                        body.error || `Failed to load (${res.status})`
                    );
                }
                return res.json();
            })
            .then(setData)
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [token]);

    const tracks = useMemo(() => data ? getTracksFromEntity(data) : [], [data]);

    const coverArtId = data ? getCoverUrl(data) : null;

    function buildCoverArtUrl(id: string): string {
        return `/api/share/${token}/cover-art/${encodeURIComponent(id)}?size=500`;
    }

    const coverArtUrl = coverArtId ? buildCoverArtUrl(coverArtId) : null;

    const totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);

    // Loading
    if (loading) {
        return (
            <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-brand/30 border-t-[#fca200] rounded-full animate-spin" />
                    <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">
                        Loading
                    </p>
                </div>
            </div>
        );
    }

    // Error
    if (error || !data) {
        return (
            <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center px-4">
                <div className="text-center max-w-sm">
                    <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                        <Music className="w-5 h-5 text-white/15" />
                    </div>
                    <p className="text-sm font-medium text-white/70 mb-1">
                        {error?.includes("expired")
                            ? "Link expired"
                            : "Not found"}
                    </p>
                    <p className="text-xs text-white/30">
                        {error || "This share link is no longer available."}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col">
            {/* Main content */}
            <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 md:py-12">
                <div className="w-full max-w-lg">

                    {/* Cover art */}
                    <div className="relative w-full aspect-square max-w-[280px] mx-auto mb-8 rounded-xl overflow-hidden bg-white/[0.03] shadow-2xl shadow-black/60">
                        {coverArtUrl ? (
                            <Image
                                src={coverArtUrl}
                                alt=""
                                fill
                                unoptimized
                                className="object-cover"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <Music className="w-16 h-16 text-white/[0.06]" />
                            </div>
                        )}
                    </div>

                    {/* Title and subtitle */}
                    <div className="text-center mb-6">
                        <h1 className="text-xl font-bold text-white tracking-tight mb-1 line-clamp-2">
                            {getEntityTitle(data)}
                        </h1>
                        <p className="text-sm text-white/40">
                            {getEntitySubtitle(data)}
                            {tracks.length > 1 && totalDuration > 0 && (
                                <span className="text-white/20"> -- {formatDuration(totalDuration)}</span>
                            )}
                        </p>
                    </div>

                    {/* Track list */}
                    {tracks.length > 0 && (
                        <div className="border-t border-white/[0.04] pt-4">
                            {tracks.map((track, index) => {
                                const trackCoverId = track.album?.coverUrl || coverArtId;
                                const trackCoverUrl = trackCoverId
                                    ? buildCoverArtUrl(trackCoverId)
                                    : null;

                                const trackNumber = track.trackNo ?? index + 1;
                                const trackLabel =
                                    track.discNumber != null && track.discNumber > 1
                                        ? `${track.discNumber}-${String(trackNumber).padStart(2, "0")}`
                                        : String(trackNumber);

                                return (
                                    <div
                                        key={track.id}
                                        className="w-full flex items-center gap-3 px-3 py-2 rounded-md"
                                    >
                                        <div className="w-8 text-center flex-shrink-0">
                                            <span className="text-[11px] font-mono text-white/15">
                                                {trackLabel}
                                            </span>
                                        </div>

                                        {trackCoverUrl && (
                                            <div className="relative w-8 h-8 rounded bg-white/[0.03] flex-shrink-0 overflow-hidden">
                                                <Image
                                                    src={trackCoverUrl}
                                                    alt=""
                                                    fill
                                                    unoptimized
                                                    className="object-cover"
                                                />
                                            </div>
                                        )}

                                        <div className="flex-1 min-w-0 text-left">
                                            <p className="text-sm text-white/70 truncate">
                                                {track.title}
                                            </p>
                                            {track.album?.artist?.name && (
                                                <p className="text-[11px] text-white/25 truncate">
                                                    {track.album.artist.name}
                                                </p>
                                            )}
                                        </div>

                                        <span className="text-[11px] font-mono text-white/15 flex-shrink-0 tabular-nums">
                                            {track.duration ? formatTime(track.duration) : ""}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-6">
                <div className="max-w-lg mx-auto flex items-center justify-center gap-3">
                    <span className="text-[10px] font-mono text-white/10 uppercase tracking-widest">
                        Powered by Kima
                    </span>
                    <span className="text-white/[0.06]">|</span>
                    <a
                        href="https://github.com/Chevron7Locked/kima-hub"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px] font-mono text-white/10 hover:text-white/25 uppercase tracking-widest transition-colors"
                    >
                        <Github className="w-3 h-3" />
                        GitHub
                    </a>
                </div>
            </div>
        </div>
    );
}
