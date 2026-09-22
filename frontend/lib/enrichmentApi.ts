/**
 * Enrichment API Client
 *
 * Client-side methods for enrichment control and failure management
 */

import { api } from "./api";

export interface EnrichmentState {
    status: "idle" | "running" | "paused" | "stopping";
    startedAt?: string;
    pausedAt?: string;
    stoppedAt?: string;
    currentPhase: "artists" | "tracks" | "audio" | "vibe" | "podcasts" | null;
    lastActivity: string;
    stoppingInfo?: {
        phase: string;
        currentItem: string;
        itemsRemaining: number;
    };
    artists: {
        total: number;
        completed: number;
        failed: number;
        current?: string;
    };
    tracks: {
        total: number;
        completed: number;
        failed: number;
        current?: string;
    };
}

export interface EnrichmentFailure {
    id: string;
    entityType: "artist" | "track" | "audio" | "vibe";
    entityId: string;
    entityName: string | null;
    errorMessage: string | null;
    errorCode: string | null;
    retryCount: number;
    maxRetries: number;
    firstFailedAt: string;
    lastFailedAt: string;
    skipped: boolean;
    skippedAt: string | null;
    resolved: boolean;
    resolvedAt: string | null;
    metadata: Record<string, unknown> | null;
}

export interface FailureCounts {
    artist: number;
    track: number;
    audio: number;
    vibe: number;
    podcast: number;
    total: number;
}

export interface ConcurrencyConfig {
    concurrency: number;
    estimatedSpeed: string;
    artistsPerMin: number;
    tracksPerMin: number;
}

export const enrichmentApi = {
    /**
     * Get detailed enrichment state
     */
    getStatus: async (): Promise<EnrichmentState | null> => {
        return api.get("/enrichment/status");
    },

    /**
     * Pause enrichment
     */
    pause: async (): Promise<{ message: string; state: EnrichmentState }> => {
        return api.post("/enrichment/pause", {});
    },

    /**
     * Resume enrichment
     */
    resume: async (): Promise<{ message: string; state: EnrichmentState }> => {
        return api.post("/enrichment/resume", {});
    },

    /**
     * Stop enrichment
     */
    stop: async (): Promise<{ message: string; state: EnrichmentState }> => {
        return api.post("/enrichment/stop", {});
    },

    /**
     * Get enrichment failures with filtering
     */
    getFailures: async (params?: {
        entityType?: "artist" | "track" | "audio" | "vibe";
        includeSkipped?: boolean;
        includeResolved?: boolean;
        limit?: number;
        offset?: number;
    }): Promise<{ failures: EnrichmentFailure[]; total: number }> => {
        const query = new URLSearchParams();
        if (params?.entityType) query.set("entityType", params.entityType);
        if (params?.includeSkipped) query.set("includeSkipped", "true");
        if (params?.includeResolved) query.set("includeResolved", "true");
        if (params?.limit) query.set("limit", params.limit.toString());
        if (params?.offset) query.set("offset", params.offset.toString());

        const queryString = query.toString();
        return api.get(
            `/enrichment/failures${queryString ? `?${queryString}` : ""}`
        );
    },

    /**
     * Get failure counts by type
     */
    getFailureCounts: async (): Promise<FailureCounts> => {
        return api.get("/enrichment/failures/counts");
    },

    /**
     * Get enrichment concurrency configuration
     */
    getConcurrency: async (): Promise<ConcurrencyConfig> => {
        return api.get("/enrichment/concurrency");
    },

    /**
     * Set enrichment concurrency (1-5)
     */
    setConcurrency: async (concurrency: number): Promise<ConcurrencyConfig> => {
        return api.request("/enrichment/concurrency", {
            method: "PUT",
            body: JSON.stringify({ concurrency }),
        });
    },

};
