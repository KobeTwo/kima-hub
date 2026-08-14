import { prisma } from "../utils/db";
import { logger } from "../utils/logger";

export interface AvailableFeatures {
    musicCNN: boolean;
    vibeEmbeddings: boolean;
    audiobookshelfEnabled: boolean;
}

export const featureDetection = {
    cache: null as { features: AvailableFeatures; lastCheck: number } | null,
    CACHE_TTL: 60000,

    async getFeatures(): Promise<AvailableFeatures> {
        const now = Date.now();

        if (this.cache && (now - this.cache.lastCheck) < this.CACHE_TTL) {
            return this.cache.features;
        }

        const features: AvailableFeatures = {
            musicCNN: false,
            vibeEmbeddings: false,
            audiobookshelfEnabled: await this.checkAudiobookshelf(),
        };

        this.cache = { features, lastCheck: now };
        logger.debug("[FeatureDetection] Available features:", features);
        return features;
    },

    async checkAudiobookshelf(): Promise<boolean> {
        try {
            const settings = await prisma.systemSettings.findFirst();
            return settings?.audiobookshelfEnabled ?? false;
        } catch {
            return false;
        }
    },

    async invalidateCache(): Promise<void> {
        this.cache = null;
    },
};