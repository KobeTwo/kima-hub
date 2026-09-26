import { prisma } from "./db";
import { logger } from "./logger";
import { encrypt, decrypt } from "./encryption";

const CACHE_TTL_MS = 60 * 1000;

export interface UserNavidromeSettings {
    userId: string;
    enabled: boolean;
    url: string | null;
    navidromeUser: string | null;
    /** Dekliffriertes Passwort (null wenn keine/gültig nicht lesbar) */
    navidromePassword: string | null;
    namePrefix: string;
}

export type UserNavidromeSettingsInput = {
    enabled?: boolean;
    url?: string | null;
    navidromeUser?: string | null;
    navidromePassword?: string | null;
    namePrefix?: string;
};

interface CacheEntry {
    settings: UserNavidromeSettings | null;
    ts: number;
}

const cache = new Map<string, CacheEntry>();
const loggedDecryptionWarnings = new Set<string>();

/**
 * Safe decrypt: liefert null (nicht throw), wenn der Zifferntext nicht
 * dekodierbar ist (z. B. nach Encryption-Key-Wechsel). Warnung nur 1x pro Feld.
 */
function safeDecrypt(value: string | null, fieldName: string): string | null {
    if (!value) return null;
    try {
        return decrypt(value);
    } catch {
        const key = `userNavidrome.${fieldName}`;
        if (!loggedDecryptionWarnings.has(key)) {
            logger.warn(
                `[UserNavidromeSettings] Failed to decrypt ${key}, treating as empty (further warnings suppressed)`
            );
            loggedDecryptionWarnings.add(key);
        }
        return null;
    }
}

export function invalidateUserNavidromeSettingsCache(userId?: string): void {
    if (userId) {
        cache.delete(userId);
    } else {
        cache.clear();
    }
}

export async function getUserNavidromeSettings(
    userId: string,
    forceRefresh = false
): Promise<UserNavidromeSettings | null> {
    const now = Date.now();
    const hit = cache.get(userId);
    if (!forceRefresh && hit && hit.ts + CACHE_TTL_MS > now) {
        return hit.settings;
    }

    const row = await prisma.userNavidromeSettings.findUnique({
        where: { userId },
    });

    const settings: UserNavidromeSettings | null = row
        ? {
              userId: row.userId,
              enabled: row.enabled,
              url: row.url,
              navidromeUser: row.navidromeUser,
              navidromePassword: safeDecrypt(
                  row.navidromePassword,
                  "navidromePassword"
              ),
              namePrefix: row.namePrefix,
          }
        : null;

    cache.set(userId, { settings, ts: now });
    return settings;
}

export async function saveUserNavidromeSettings(
    userId: string,
    data: UserNavidromeSettingsInput
): Promise<UserNavidromeSettings> {
    const existing = await prisma.userNavidromeSettings.findUnique({
        where: { userId },
    });

    // update: nur Felder mitklappen, die gesetzt sind. Passwort:
    //   - Nicht-leerer String -> neu verschlüsseln
    //   - null                -> löschen
    //   - undefined / ""      -> unverändert lassen
    const update: Record<string, unknown> = {};
    if (data.enabled !== undefined) update.enabled = data.enabled;
    if (data.url !== undefined) update.url = data.url;
    if (data.navidromeUser !== undefined) update.navidromeUser = data.navidromeUser;
    if (data.namePrefix !== undefined) update.namePrefix = data.namePrefix;
    if (
        typeof data.navidromePassword === "string" &&
        data.navidromePassword.length > 0
    ) {
        update.navidromePassword = encrypt(data.navidromePassword);
    } else if (data.navidromePassword === null && existing?.navidromePassword) {
        update.navidromePassword = null;
    }

    const row = await prisma.userNavidromeSettings.upsert({
        where: { userId },
        update,
        create: {
            userId,
            enabled: data.enabled ?? false,
            url: data.url ?? null,
            navidromeUser: data.navidromeUser ?? null,
            navidromePassword:
                typeof data.navidromePassword === "string" &&
                data.navidromePassword.length > 0
                    ? encrypt(data.navidromePassword)
                    : null,
            namePrefix: data.namePrefix ?? "",
        },
    });

    invalidateUserNavidromeSettingsCache(userId);
    return {
        userId: row.userId,
        enabled: row.enabled,
        url: row.url,
        navidromeUser: row.navidromeUser,
        navidromePassword: safeDecrypt(row.navidromePassword, "navidromePassword"),
        namePrefix: row.namePrefix,
    };
}
