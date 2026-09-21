import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { SystemSettings } from "../types";

const defaultSystemSettings: SystemSettings = {
    lidarrEnabled: true,
    lidarrUrl: "http://localhost:8686",
    lidarrApiKey: "",
    openaiEnabled: false,
    openaiApiKey: "",
    openaiModel: "gpt-4",
    fanartEnabled: false,
    fanartApiKey: "",
    lastfmApiKey: "",
    soulseekUsername: "",
    soulseekPassword: "",
    soulseekMode: "p2p",
    slskdUrl: "",
    slskdApiKey: "",
    spotifyClientId: "",
    spotifyClientSecret: "",
    musicPath: "/music",
    downloadPath: "/downloads",
    autoSync: true,
    autoEnrichMetadata: true,
    audioAnalyzerWorkers: 2,
    soulseekConcurrentDownloads: 4,
    lidarrQualityProfileId: null,
    lidarrMetadataProfileId: null,
    // Download preferences
    downloadSource: "soulseek",
    primaryFailureFallback: "none",
    // Server
    publicUrl: "",
    // Navidrome Sync
    navidromeSyncEnabled: false,
    navidromeUrl: "",
    navidromeUser: "",
    navidromePassword: "",
    navidromeNamePrefix: "",
};

export function useSystemSettings() {
    const { isAuthenticated, user } = useAuth();
    const [systemSettings, setSystemSettings] = useState<SystemSettings>(
        defaultSystemSettings
    );
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const isAdmin = user?.role === "admin";

    useEffect(() => {
        if (isAuthenticated && isAdmin) {
            loadSystemSettings();
        }
    }, [isAuthenticated, isAdmin]);

    const loadSystemSettings = async () => {
        try {
            setIsLoading(true);
            const sysData = await api.getSystemSettings();

            // Sanitize null values to empty strings for controlled inputs
            const sanitizeSettings = (settings: Record<string, unknown>): SystemSettings => {
                const sanitized: Record<string, unknown> = {};
                for (const key in settings) {
                    const value = settings[key];
                    // Convert null to empty string for string fields
                    if (value === null && typeof defaultSystemSettings[key as keyof SystemSettings] === 'string') {
                        sanitized[key] = '';
                    } else {
                        sanitized[key] = value;
                    }
                }
                return sanitized as unknown as SystemSettings;
            };

            setSystemSettings(sanitizeSettings(sysData));
        } catch (error) {
            console.error("Failed to load system settings:", error);
            // No toast - error will be visible in the UI if settings fail to load
        } finally {
            setIsLoading(false);
        }
    };

    const saveSystemSettings = async (settingsToSave: SystemSettings) => {
        try {
            setIsSaving(true);
            await api.updateSystemSettings(settingsToSave);
        } catch (error) {
            console.error("Failed to save system settings:", error);
            throw error;
        } finally {
            setIsSaving(false);
        }
    };

    const updateSystemSettings = (updates: Partial<SystemSettings>) => {
        setSystemSettings((prev) => ({ ...prev, ...updates }));
    };

    /**
     * Test a service connection
     * Returns { success: true, version?: string } or { success: false, error: string }
     * Caller handles displaying the result inline
     */
    const testService = async (service: string): Promise<{ success: boolean; version?: string; error?: string }> => {
        try {
            let result;
            switch (service) {
                case "lidarr":
                    result = await api.testLidarr(
                        systemSettings.lidarrUrl,
                        systemSettings.lidarrApiKey
                    );
                    break;
                case "openai":
                    result = await api.testOpenai(
                        systemSettings.openaiApiKey,
                        systemSettings.openaiModel
                    );
                    break;
                case "fanart":
                    result = await api.testFanart(systemSettings.fanartApiKey);
                    break;
                case "lastfm":
                    result = await api.testLastfm(systemSettings.lastfmApiKey);
                    break;
                case "soulseek":
                    result = await api.testSoulseek(
                        systemSettings.soulseekUsername,
                        systemSettings.soulseekPassword
                    );
                    break;
                case "spotify":
                    result = await api.testSpotify(
                        systemSettings.spotifyClientId,
                        systemSettings.spotifyClientSecret
                    );
                    break;
                case "navidrome":
                    result = await api.testNavidrome(
                        systemSettings.navidromeUrl,
                        systemSettings.navidromeUser,
                        systemSettings.navidromePassword
                    );
                    break;
                default:
                    throw new Error(`Unknown service: ${service}`);
            }

            return { success: true, version: result?.version };
        } catch (error: unknown) {
            console.error(`Failed to test ${service}:`, error);
            return { success: false, error: error instanceof Error ? error.message : `Failed to connect` };
        }
    };

    return {
        systemSettings,
        isLoading,
        isSaving,
        setSystemSettings,
        updateSystemSettings,
        saveSystemSettings,
        testService,
        loadSystemSettings,
    };
}
