jest.mock("../db", () => ({
    prisma: {
        userNavidromeSettings: {
            findUnique: jest.fn(),
            upsert: jest.fn(),
        },
    },
}));

jest.mock("../encryption", () => ({
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string | null) => (v ? String(v).replace(/^enc:/, "") : null)),
}));

jest.mock("../logger", () => ({
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { prisma } from "../db";
import { logger } from "../logger";
import {
    getUserNavidromeSettings,
    saveUserNavidromeSettings,
    invalidateUserNavidromeSettingsCache,
} from "../userNavidromeSettings";

const mockedPrisma = jest.mocked(prisma);

describe("userNavidromeSettings", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        invalidateUserNavidromeSettingsCache();
    });

    describe("getUserNavidromeSettings", () => {
        it("returns null when no row exists", async () => {
            mockedPrisma.userNavidromeSettings.findUnique.mockResolvedValue(null);
            await expect(getUserNavidromeSettings("u-1")).resolves.toBeNull();
            expect(mockedPrisma.userNavidromeSettings.findUnique).toHaveBeenCalledWith(
                { where: { userId: "u-1" } }
            );
        });

        it("returns the row with decrypted password", async () => {
            mockedPrisma.userNavidromeSettings.findUnique.mockResolvedValue({
                id: "ids-1",
                userId: "u-1",
                enabled: true,
                url: "http://nd:4533",
                navidromeUser: "anna",
                navidromePassword: "enc:secret",
                namePrefix: "Anna: ",
                createdAt: new Date(),
                updatedAt: new Date(),
            } as never);
            await expect(getUserNavidromeSettings("u-1")).resolves.toEqual({
                userId: "u-1",
                enabled: true,
                url: "http://nd:4533",
                navidromeUser: "anna",
                navidromePassword: "secret",
                namePrefix: "Anna: ",
            });
        });

        it("serves the second call from cache (no second DB hit within TTL)", async () => {
            mockedPrisma.userNavidromeSettings.findUnique.mockResolvedValue(null);
            await getUserNavidromeSettings("u-1");
            await getUserNavidromeSettings("u-1");
            expect(mockedPrisma.userNavidromeSettings.findUnique).toHaveBeenCalledTimes(1);
        });

        it("forceRefresh bypasses the cache", async () => {
            mockedPrisma.userNavidromeSettings.findUnique.mockResolvedValue(null);
            await getUserNavidromeSettings("u-1");
            await getUserNavidromeSettings("u-1", true);
            expect(mockedPrisma.userNavidromeSettings.findUnique).toHaveBeenCalledTimes(2);
        });

        it("returns null password for a corrupted ciphertext and warns only once", async () => {
            // decrypt-Throw simulieren: für diesen Wert decrypt wirft
            mockedPrisma.userNavidromeSettings.findUnique.mockResolvedValue({
                id: "ids-2",
                userId: "u-1",
                enabled: true,
                url: "http://nd:4533",
                navidromeUser: "anna",
                navidromePassword: "totally-not-encrypted",
                namePrefix: "",
                createdAt: new Date(),
                updatedAt: new Date(),
            } as never);
            const { decrypt } = jest.requireMock("../encryption");
            decrypt.mockImplementation((v: string | null) => {
                if (v === "totally-not-encrypted") throw new Error("bad data");
                return v;
            });
            const result = await getUserNavidromeSettings("u-1", true);
            expect(result?.navidromePassword).toBeNull();
            expect(result?.navidromeUser).toBe("anna"); // andere Felder bleiben
            expect(logger.warn).toHaveBeenCalledTimes(1);
            // zweiter gezwungener Refresh: keine zweite Warnung (kein Spam)
            await getUserNavidromeSettings("u-1", true);
            expect(logger.warn).toHaveBeenCalledTimes(1);
            // decrypt-Mock auf Standard-Implementierung zurückstellen (sonst stört er Folge-Tests)
            decrypt.mockImplementation((v: string | null) =>
                v ? String(v).replace(/^enc:/, "") : null
            );
        });
    });

    describe("saveUserNavidromeSettings", () => {
        it("creates a new row with encrypted password", async () => {
            mockedPrisma.userNavidromeSettings.findUnique.mockResolvedValue(null);
            mockedPrisma.userNavidromeSettings.upsert.mockResolvedValue({
                id: "ids-new",
                userId: "u-1",
                enabled: true,
                url: "http://nd:4533",
                navidromeUser: "anna",
                navidromePassword: "enc:secret",
                namePrefix: "Anna: ",
                createdAt: new Date(),
                updatedAt: new Date(),
            } as never);

            await saveUserNavidromeSettings("u-1", {
                enabled: true,
                url: "http://nd:4533",
                navidromeUser: "anna",
                navidromePassword: "secret",
                namePrefix: "Anna: ",
            });

            const upsertArg = mockedPrisma.userNavidromeSettings.upsert.mock.calls[0][0];
            expect(upsertArg.where).toEqual({ userId: "u-1" });
            expect(upsertArg.create.navidromePassword).toBe("enc:secret");
            expect(upsertArg.create.enabled).toBe(true);
        });

        it("keeps the existing password when none is provided", async () => {
            mockedPrisma.userNavidromeSettings.findUnique.mockResolvedValue({
                userId: "u-1",
                navidromePassword: "enc:old",
            } as never);
            mockedPrisma.userNavidromeSettings.upsert.mockResolvedValue({
                userId: "u-1",
                enabled: false,
                url: "http://nd:4533",
                navidromeUser: "anna",
                navidromePassword: "enc:old",
                namePrefix: "",
            } as never);

            await saveUserNavidromeSettings("u-1", { enabled: false, namePrefix: "" });

            const upsertArg = mockedPrisma.userNavidromeSettings.upsert.mock.calls[0][0];
            expect(upsertArg.update.navidromePassword).toBeUndefined();
            expect(upsertArg.update.enabled).toBe(false);
        });

        it("clears the password when explicitly null", async () => {
            mockedPrisma.userNavidromeSettings.findUnique.mockResolvedValue({
                userId: "u-1",
                navidromePassword: "enc:old",
            } as never);
            mockedPrisma.userNavidromeSettings.upsert.mockResolvedValue({
                userId: "u-1",
                enabled: true,
                url: "http://nd:4533",
                navidromeUser: "anna",
                navidromePassword: null,
                namePrefix: "",
            } as never);

            await saveUserNavidromeSettings("u-1", { navidromePassword: null });

            const upsertArg = mockedPrisma.userNavidromeSettings.upsert.mock.calls[0][0];
            expect(upsertArg.update.navidromePassword).toBeNull();
        });

        it("invalidates the per-user cache and returns fresh decrypted settings", async () => {
            mockedPrisma.userNavidromeSettings.findUnique
                .mockResolvedValueOnce(null as never) // Cache-Befüllung (alt)
                .mockResolvedValue({
                    userId: "u-1",
                    enabled: true,
                    url: "http://nd:4533",
                    navidromeUser: "anna",
                    navidromePassword: "enc:new",
                    namePrefix: "A ",
                } as never); // Existing-Read im Save
            mockedPrisma.userNavidromeSettings.upsert.mockResolvedValue({
                id: "ids-1",
                userId: "u-1",
                enabled: true,
                url: "http://nd:4533",
                navidromeUser: "anna",
                navidromePassword: "enc:new",
                namePrefix: "A ",
                createdAt: new Date(),
                updatedAt: new Date(),
            } as never); // upsert-Ergebnis

            await getUserNavidromeSettings("u-1"); // füllt Cache mit null
            const saved = await saveUserNavidromeSettings("u-1", {
                enabled: true,
                url: "http://nd:4533",
                navidromeUser: "anna",
                navidromePassword: "new",
                namePrefix: "A ",
            });
            expect(saved.navidromePassword).toBe("new");
            // Cache ist invalidated: nächster Read geht wieder ans DB
            const readsBefore =
                mockedPrisma.userNavidromeSettings.findUnique.mock.calls.length;
            await getUserNavidromeSettings("u-1");
            expect(
                mockedPrisma.userNavidromeSettings.findUnique.mock.calls.length
            ).toBe(readsBefore + 1);
        });
    });
});
