"use client";

import { useState } from "react";
import { SettingsSection, SettingsRow, SettingsInput, SettingsToggle } from "../ui";
import { SystemSettings } from "../../types";
import { InlineStatus, StatusType } from "@/components/ui/InlineStatus";
import { api } from "@/lib/api";

interface NavidromeSyncSectionProps {
    settings: SystemSettings;
    onUpdate: (updates: Partial<SystemSettings>) => void;
    onTest: (service: string) => Promise<{ success: boolean; version?: string; error?: string }>;
    isTesting: boolean;
}

export function NavidromeSyncSection({ settings, onUpdate, onTest, isTesting }: NavidromeSyncSectionProps) {
    const [testStatus, setTestStatus] = useState<StatusType>("idle");
    const [testMessage, setTestMessage] = useState("");
    const [syncStatus, setSyncStatus] = useState<StatusType>("idle");
    const [syncMessage, setSyncMessage] = useState("");

    const handleTest = async () => {
        setTestStatus("loading");
        setTestMessage("Testing...");
        const result = await onTest("navidrome");
        if (result.success) {
            setTestStatus("success");
            setTestMessage(result.version ? `v${result.version}` : "Connected");
        } else {
            setTestStatus("error");
            setTestMessage(result.error || "Failed");
        }
    };

    const handleSyncNow = async () => {
        setSyncStatus("loading");
        setSyncMessage("Syncing...");
        try {
            const data = await api.syncNavidromeNow();
            const results: Array<{ status: string }> =
                (data as { results?: Array<{ status: string }> })?.results || [];
            const synced = results.filter((r) => r.status === "synced").length;
            const failed = results.filter((r) => r.status === "error").length;
            const skipped = results.length - synced - failed;
            setSyncStatus(failed > 0 ? "error" : "success");
            setSyncMessage(
                `${synced} of ${results.length} playlists synced` +
                    (skipped > 0 ? ` (${skipped} skipped)` : "") +
                    (failed > 0 ? ` (${failed} failed)` : "")
            );
        } catch (error: unknown) {
            setSyncStatus("error");
            setSyncMessage(error instanceof Error ? error.message : "Sync failed");
        }
    };

    return (
        <SettingsSection
            id="navidrome-sync"
            title="Navidrome Sync"
            description="Mirror Kima playlists to Navidrome so they play in any Subsonic client"
        >
            <SettingsRow
                label="Enable Navidrome sync"
                description="Sync playlists after imports, scans and manual edits"
                htmlFor="navidrome-sync-enabled"
            >
                <SettingsToggle
                    id="navidrome-sync-enabled"
                    checked={settings.navidromeSyncEnabled}
                    onChange={(checked) => onUpdate({ navidromeSyncEnabled: checked })}
                />
            </SettingsRow>

            {settings.navidromeSyncEnabled && (
                <>
                    <SettingsRow label="Navidrome URL" htmlFor="navidrome-sync-url">
                        <SettingsInput
                            id="navidrome-sync-url"
                            value={settings.navidromeUrl}
                            onChange={(v) => onUpdate({ navidromeUrl: v })}
                            placeholder="http://host.docker.internal:4533"
                            className="w-64"
                        />
                    </SettingsRow>

                    <SettingsRow label="Username" htmlFor="navidrome-sync-user">
                        <SettingsInput
                            id="navidrome-sync-user"
                            value={settings.navidromeUser}
                            onChange={(v) => onUpdate({ navidromeUser: v })}
                            placeholder="Navidrome username"
                            className="w-64"
                        />
                    </SettingsRow>

                    <SettingsRow label="Password" htmlFor="navidrome-sync-password">
                        <SettingsInput
                            id="navidrome-sync-password"
                            type="password"
                            value={settings.navidromePassword}
                            onChange={(v) => onUpdate({ navidromePassword: v })}
                            placeholder="Navidrome password"
                            className="w-64"
                        />
                    </SettingsRow>

                    <SettingsRow label="Name prefix" htmlFor="navidrome-sync-prefix">
                        <SettingsInput
                            id="navidrome-sync-prefix"
                            value={settings.navidromeNamePrefix}
                            onChange={(v) => onUpdate({ navidromeNamePrefix: v })}
                            placeholder="(optional, e.g. Kima: )"
                            className="w-64"
                        />
                    </SettingsRow>

                    <div className="pt-2">
                        <div className="inline-flex items-center gap-3">
                            <button
                                onClick={handleTest}
                                disabled={
                                    isTesting ||
                                    !settings.navidromeUrl ||
                                    !settings.navidromeUser ||
                                    !settings.navidromePassword
                                }
                                className="px-4 py-1.5 text-xs font-mono bg-white/5 border border-white/10 text-white/70 rounded-lg uppercase tracking-wider
                                    hover:bg-white/10 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {testStatus === "loading" ? "Testing..." : "Test Connection"}
                            </button>
                            <InlineStatus
                                status={testStatus}
                                message={testMessage}
                                onClear={() => setTestStatus("idle")}
                            />
                        </div>
                    </div>

                    <div className="pt-2">
                        <div className="inline-flex items-center gap-3">
                            <button
                                onClick={handleSyncNow}
                                disabled={
                                    syncStatus === "loading" ||
                                    !settings.navidromeUrl ||
                                    !settings.navidromeUser ||
                                    !settings.navidromePassword
                                }
                                className="px-4 py-1.5 text-xs font-mono bg-white/5 border border-white/10 text-white/70 rounded-lg uppercase tracking-wider
                                    hover:bg-white/10 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {syncStatus === "loading" ? "Syncing..." : "Sync Now"}
                            </button>
                            <InlineStatus
                                status={syncStatus}
                                message={syncMessage}
                                onClear={() => setSyncStatus("idle")}
                            />
                        </div>
                        <p className="mt-2 text-xs font-mono text-white/30 uppercase tracking-wider">
                            Uses saved settings — save changes first.
                        </p>
                    </div>
                </>
            )}
        </SettingsSection>
    );
}
