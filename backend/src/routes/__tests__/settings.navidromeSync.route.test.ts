/**
 * Per-User Navidrome-Sync-Endpunkte auf /api/settings/navidrome-sync/me
 * - nur requireAuth (kein Admin), GET/POST eigene Config, Test, Sync-now
 */

jest.mock("../../utils/db", () => ({
    prisma: {
        user: { findUnique: jest.fn() },
        apiKey: { findUnique: jest.fn(), update: jest.fn() },
        userNavidromeSettings: { findUnique: jest.fn(), upsert: jest.fn() },
    },
}));

jest.mock("../../utils/logger", () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../utils/encryption", () => ({
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string | null) => (v ? String(v).replace(/^enc:/, "") : null)),
}));

jest.mock("../../services/staleJobCleanup", () => ({
    staleJobCleanupService: { cleanupAll: jest.fn().mockResolvedValue({}) },
}));

jest.mock("../../utils/userNavidromeSettings", () => ({
    getUserNavidromeSettings: jest.fn(),
    saveUserNavidromeSettings: jest.fn(),
    invalidateUserNavidromeSettingsCache: jest.fn(),
}));

jest.mock("../../services/navidromeSync", () => ({
    navidromeSync: {
        testConnection: jest.fn(),
        syncUserPlaylists: jest.fn(),
    },
}));

import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import settingsRoutes from "../../routes/settings";
import { prisma } from "../../utils/db";
import { getUserNavidromeSettings, saveUserNavidromeSettings } from "../../utils/userNavidromeSettings";
import { navidromeSync } from "../../services/navidromeSync";

const JWT_SECRET = process.env.JWT_SECRET!;

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use("/settings", settingsRoutes);
    return app;
}

function token(role = "user") {
    return jwt.sign(
        { userId: "u-anna", username: "anna", role, tokenVersion: 1 },
        JWT_SECRET,
        { expiresIn: "1h" }
    );
}

describe("GET /settings/navidrome-sync/me", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: "u-anna",
            username: "anna",
            role: "user",
            tokenVersion: 1,
        });
        (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(null);
    });

    it("rejects unauthenticated requests with 401", async () => {
        const app = makeApp();
        const res = await request(app).get("/settings/navidrome-sync/me");
        expect(res.status).toBe(401);
    });

    it("returns null settings for a user without config", async () => {
        (getUserNavidromeSettings as jest.Mock).mockResolvedValue(null);
        const app = makeApp();
        const res = await request(app)
            .get("/settings/navidrome-sync/me")
            .set("Authorization", `Bearer ${token()}`);
        expect(res.status).toBe(200);
        expect(res.body).toBeNull();
        expect(getUserNavidromeSettings).toHaveBeenCalledWith("u-anna");
    });

    it("returns settings with decrypted password (non-admin allowed)", async () => {
        (getUserNavidromeSettings as jest.Mock).mockResolvedValue({
            userId: "u-anna",
            enabled: true,
            url: "http://nd:4533",
            navidromeUser: "anna",
            navidromePassword: "anna-secret",
            namePrefix: "Anna: ",
        } as never);
        const app = makeApp();
        const res = await request(app)
            .get("/settings/navidrome-sync/me")
            .set("Authorization", `Bearer ${token()}`);
        expect(res.status).toBe(200);
        expect(res.body.navidromePassword).toBe("anna-secret");
    });
});

describe("POST /settings/navidrome-sync/me", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: "u-anna",
            username: "anna",
            role: "user",
            tokenVersion: 1,
        });
        (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(null);
    });

    const SAVED = {
        userId: "u-anna",
        enabled: true,
        url: "http://nd:4533",
        navidromeUser: "anna",
        navidromePassword: "anna-secret",
        namePrefix: "Anna: ",
    };

    it("saves and returns the decrypted settings", async () => {
        (saveUserNavidromeSettings as jest.Mock).mockResolvedValue(SAVED as never);
        const app = makeApp();
        const res = await request(app)
            .post("/settings/navidrome-sync/me")
            .set("Authorization", `Bearer ${token()}`)
            .send({
                enabled: true,
                url: "http://nd:4533",
                navidromeUser: "anna",
                navidromePassword: "anna-secret",
                namePrefix: "Anna: ",
            });
        expect(res.status).toBe(200);
        expect(saveUserNavidromeSettings).toHaveBeenCalledWith("u-anna", {
            enabled: true,
            url: "http://nd:4533",
            navidromeUser: "anna",
            navidromePassword: "anna-secret",
            namePrefix: "Anna: ",
        });
        expect(res.body.navidromePassword).toBe("anna-secret");
    });

    it("rejects invalid bodies with 400 (zod)", async () => {
        const app = makeApp();
        const res = await request(app)
            .post("/settings/navidrome-sync/me")
            .set("Authorization", `Bearer ${token()}`)
            .send({ enabled: "not-a-boolean" });
        expect(res.status).toBe(400);
        expect(saveUserNavidromeSettings).not.toHaveBeenCalled();
    });
});

describe("POST /settings/navidrome-sync/me/test", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: "u-anna",
            username: "anna",
            role: "user",
            tokenVersion: 1,
        });
        (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(null);
    });

    it("requires url/username/password (400)", async () => {
        const app = makeApp();
        const res = await request(app)
            .post("/settings/navidrome-sync/me/test")
            .set("Authorization", `Bearer ${token()}`)
            .send({ url: "http://nd:4533" });
        expect(res.status).toBe(400);
    });

    it("maps a working connection to success", async () => {
        (navidromeSync.testConnection as jest.Mock).mockResolvedValue({ ok: true });
        const app = makeApp();
        const res = await request(app)
            .post("/settings/navidrome-sync/me/test")
            .set("Authorization", `Bearer ${token()}`)
            .send({ url: "http://nd:4533", username: "anna", password: "p" });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(navidromeSync.testConnection).toHaveBeenCalledWith("http://nd:4533", "anna", "p");
    });

    it("maps connection failures to 502", async () => {
        (navidromeSync.testConnection as jest.Mock).mockResolvedValue({
            ok: false,
            error: "Navidrome getPlaylists failed: 401",
        });
        const app = makeApp();
        const res = await request(app)
            .post("/settings/navidrome-sync/me/test")
            .set("Authorization", `Bearer ${token()}`)
            .send({ url: "http://nd:4533", username: "anna", password: "wrong" });
        expect(res.status).toBe(502);
        expect(res.body.error).toContain("401");
    });
});

describe("POST /settings/navidrome-sync/me/sync-now", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: "u-anna",
            username: "anna",
            role: "user",
            tokenVersion: 1,
        });
        (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(null);
    });

    it("syncs only the calling user's playlists (Review Focus 5)", async () => {
        (navidromeSync.syncUserPlaylists as jest.Mock).mockResolvedValue([
            { playlistId: "p1", name: "Road Trip", status: "synced", target: "personal" },
        ]);
        const app = makeApp();
        const res = await request(app)
            .post("/settings/navidrome-sync/me/sync-now")
            .set("Authorization", `Bearer ${token()}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.results).toHaveLength(1);
        expect(navidromeSync.syncUserPlaylists).toHaveBeenCalledWith("u-anna");
    });
});
