"use client";

import { useEffect, useState } from "react";
import {
    SettingsSection,
    SettingsRow,
    SettingsInput,
    SettingsToggle,
} from "../ui";
import { PersonalNavidromeSyncSettings } from "../../types";
import { InlineStatus, StatusType } from "@/components/ui/InlineStatus";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const EMPTY: PersonalNavidromeSyncSettings = {
    enabled: false,
    url: "",
    navidromeUser: "",
    navidromePassword: "",
    namePrefix: "",
};

export function PersonalNavidromeSyncSection() {
    const { isAuthenticated } = useAuth();
    const [settings, setSettings] = useState<PersonalNavidromeSyncSettings>(EMPTY);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<StatusType>("idle");
    const [saveMessage, setSaveMessage] = useState("");
    const [testStatus, setTestStatus] = useState<StatusType>("idle");
    const [testMessage, setTestMessage] = useState("");
    const [syncStatus, setSyncStatus] = useState<StatusType>("idle");
    const [syncMessage, setSyncMessage] = useState("");

    // Eigene Config laden (unabhängig vom Admin-SystemSettings-Fluss)
    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;
        (async () => {
            try {
                const s = await api.getMyNavidromeSync();
                if (cancelled || !s) return;
                setSettings({
                    enabled: !!s.enabled,
                    url: s.url ?? "",
                    navidromeUser: s.navidromeUser ?? "",
                    navidromePassword: s.navidromePassword ?? "",
                    namePrefix: s.namePrefix ?? "",
                });
            } catch (error) {
                console.error("Failed to load personal Navidrome sync settings:", error);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isAuthenticated]);

    const update = (patch: Partial<PersonalNavidromeSyncSettings>) =>
        setSettings((prev) => ({ ...prev, ...patch }));

    const handleSave = async () => {
        setIsSaving(true);
        setSaveStatus("loading");
        setSaveMessage("");
        try {
            await api.saveMyNavidromeSync({
                enabled: settings.enabled,
                url: settings.url || null,
                navidromeUser: settings.navidromeUser || null,
                // leeres Passwort = "unverändert lassen" (Backend-Semantik)
                navidromePassword: settings.navidromePassword,
                namePrefix: settings.namePrefix,
            });
            setSaveStatus("success");
            setSaveMessage("Gespeichert");
        } catch (error) {
            setSaveStatus("error");
            setSaveMessage(
                error instanceof Error ? error.message : "Speichern fehlgeschlagen"
            );
        } finally {
            setIsSaving(false);
        }
    };

    const handleTest = async () => {
        setTestStatus("loading");
        setTestMessage("Testing...");
        try {
            await api.testMyNavidromeSync(
                settings.url ?? "",
                settings.navidromeUser ?? "",
                settings.navidromePassword ?? ""
            );
            setTestStatus("success");
            setTestMessage("Connected");
        } catch (error) {
            setTestStatus("error");
            setTestMessage(
                error instanceof Error ? error.message : "Connection failed"
            );
        }
    };

    const handleSyncNow = async () => {
        setSyncStatus("loading");
        setSyncMessage("Syncing...");
        try {
            const data = await api.syncMyNavidromeNow();
            const results: Array<{ status: string }> =
                (data as { results?: Array<{ status: string }> })?.results || [];
            const synced = results.filter((r) => r.status === "synced").length;
            const failed = results.filter((r) => r.status === "error").length;
            const skipped = results.length - synced - failed;
            setSyncStatus(failed > 0 ? "error" : "success");
            setSyncMessage(
                `${synced} of ${results.length} playlist syncs succeeded` +
                    (skipped > 0 ? ` (${skipped} skipped)` : "") +
                    (failed > 0 ? ` (${failed} failed)` : "")
            );
        } catch (error) {
            setSyncStatus("error");
            setSyncMessage(error instanceof Error ? error.message : "Sync failed");
        }
    };

    return (
        <SettingsSection
            id="navidrome-sync-personal"
            title="Navidrome Sync (persönlich)"
            description="Optional: zusätzlich zu den globalen Settings spiegelst du deine eigenen Playlists in ein eigenes Navidrome-Konto"
        >
            <SettingsRow
                label="Persönlichen Sync aktivieren"
                description="Deine Playlists werden zusätzlich zu den globalen Zielen in dein Navidrome-Konto gesynct"
                htmlFor="personal-navidrome-enabled"
            >
                <SettingsToggle
                    id="personal-navidrome-enabled"
                    checked={settings.enabled}
                    onChange={(checked) => update({ enabled: checked })}
                />
            </SettingsRow>

            {settings.enabled && (
                <>
                    <SettingsRow label="Navidrome URL" htmlFor="personal-navidrome-url">
                        <SettingsInput
                            id="personal-navidrome-url"
                            value={settings.url ?? ""}
                            onChange={(v) => update({ url: v })}
                            placeholder="http://navidrome:4533"
                            className="w-64"
                        />
                    </SettingsRow>

                    <SettingsRow
                        label="Dein Navidrome-User"
                        htmlFor="personal-navidrome-user"
                    >
                        <SettingsInput
                            id="personal-navidrome-user"
                            value={settings.navidromeUser ?? ""}
                            onChange={(v) => update({ navidromeUser: v })}
                            placeholder="Dein Navidrome-Benutzername"
                            className="w-64"
                        />
                    </SettingsRow>

                    <SettingsRow
                        label="Dein Passwort"
                        htmlFor="personal-navidrome-password"
                    >
                        <SettingsInput
                            id="personal-navidrome-password"
                            type="password"
                            value={settings.navidromePassword ?? ""}
                            onChange={(v) => update({ navidromePassword: v })}
                            placeholder="Dein Navidrome-Passwort"
                            className="w-64"
                        />
                    </SettingsRow>

                    <SettingsRow
                        label="Name prefix"
                        htmlFor="personal-navidrome-prefix"
                    >
                        <SettingsInput
                            id="personal-navidrome-prefix"
                            value={settings.namePrefix}
                            onChange={(v) => update({ namePrefix: v })}
                            placeholder="(optional, z. B. Anna: )"
                            className="w-64"
                        />
                    </SettingsRow>

                    <div className="pt-2">
                        <div className="inline-flex items-center gap-3">
                            <button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="px-4 py-1.5 text-xs font-mono bg-white/5 border border-white/10 text-white/70 rounded-lg uppercase tracking-wider
                                    hover:bg-white/10 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {isSaving ? "Saving..." : "Save My Settings"}
                            </button>
                            <button
                                onClick={handleTest}
                                disabled={
                                    !settings.url ||
                                    !settings.navidromeUser ||
                                    !settings.navidromePassword
                                }
                                className="px-4 py-1.5 text-xs font-mono bg-white/5 border border-white/10 text-white/70 rounded-lg uppercase tracking-wider
                                    hover:bg-white/10 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {testStatus === "loading"
                                    ? "Testing..."
                                    : "Test Connection"}
                            </button>
                            <InlineStatus
                                status={testStatus}
                                message={testMessage}
                                onClear={() => setTestStatus("idle")}
                            />
                        </div>
                        <div className="mt-2">
                            <InlineStatus
                                status={saveStatus}
                                message={saveMessage}
                                onClear={() => setSaveStatus("idle")}
                            />
                        </div>
                    </div>

                    <div className="pt-2">
                        <div className="inline-flex items-center gap-3">
                            <button
                                onClick={handleSyncNow}
                                disabled={
                                    syncStatus === "loading" ||
                                    !settings.url ||
                                    !settings.navidromeUser ||
                                    !settings.navidromePassword
                                }
                                className="px-4 py-1.5 text-xs font-mono bg-white/5 border border-white/10 text-white/70 rounded-lg uppercase tracking-wider
                                    hover:bg-white/10 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {syncStatus === "loading"
                                    ? "Syncing..."
                                    : "Sync My Playlists Now"}
                            </button>
                            <InlineStatus
                                status={syncStatus}
                                message={syncMessage}
                                onClear={() => setSyncStatus("idle")}
                            />
                        </div>
                        <p className="mt-2 text-xs font-mono text-white/30 uppercase tracking-wider">
                            Syncet deine Playlists zu allen aktiven Zielen (global + hier gespeichertes Ziel).
                        </p>
                    </div>
                </>
            )}
        </SettingsSection>
    );
}
