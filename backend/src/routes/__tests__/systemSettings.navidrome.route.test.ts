/**
 * Navidrome-Sync Endpoints on /api/system-settings
 * - test-navidrome: admin-only, delegates to navidromeSync.testConnection
 * - navidrome-sync/now: admin-only, 400 when unconfigured, else syncAll
 */

jest.mock("../../utils/db", () => ({
    prisma: {
        user: { findUnique: jest.fn() },
        apiKey: { findUnique: jest.fn(), update: jest.fn() },
        systemSettings: {
            findUnique: jest.fn(),
            upsert: jest.fn(),
            create: jest.fn(),
        },
    },
}));

jest.mock("../../utils/logger", () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../utils/encryption", () => ({
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string | null) => (v ? v.replace(/^enc:/, "") : null)),
}));

jest.mock("../../utils/envWriter", () => ({
    writeEnvFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../jobs/queueCleaner", () => ({
    queueCleaner: {
        getStatus: jest.fn(() => ({ running: false })),
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn(),
    },
}));

jest.mock("../../utils/systemSettings", () => ({
    getSystemSettings: jest.fn(),
    invalidateSystemSettingsCache: jest.fn(),
}));

jest.mock("../../services/navidromeSync", () => ({
    navidromeSync: {
        testConnection: jest.fn(),
        syncAll: jest.fn(),
        syncPlaylist: jest.fn(),
    },
}));

import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import systemSettingsRoutes from "../../routes/systemSettings";
import { prisma } from "../../utils/db";
import { getSystemSettings } from "../../utils/systemSettings";
import { navidromeSync } from "../../services/navidromeSync";

const JWT_SECRET = process.env.JWT_SECRET!;

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use("/system-settings", systemSettingsRoutes);
    return app;
}

function token(role = "admin") {
    return jwt.sign(
        { userId: "u-1", username: "admin", role, tokenVersion: 1 },
        JWT_SECRET,
        { expiresIn: "1h" }
    );
}

const CONFIGURED = {
    navidromeSyncEnabled: true,
    navidromeUrl: "http://navidrome:4533",
    navidromeUser: "robert",
    navidromePassword: "secret",
    navidromeNamePrefix: "",
};

describe("POST /system-settings/test-navidrome", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: "u-1",
            username: "admin",
            role: "admin",
            tokenVersion: 1,
        });
        (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(null);
    });

    it("rejects unauthenticated requests with 401", async () => {
        const app = makeApp();
        const res = await request(app).post("/system-settings/test-navidrome").send({});
        expect(res.status).toBe(401);
    });

    it("rejects non-admin users with 403", async () => {
        const app = makeApp();
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: "u-1",
            username: "user",
            role: "user",
            tokenVersion: 1,
        });
        const res = await request(app)
            .post("/system-settings/test-navidrome")
            .set("Authorization", `Bearer ${token("user")}`)
            .send({});
        expect(res.status).toBe(403);
    });

    it("requires url/username/password (400)", async () => {
        const app = makeApp();
        const res = await request(app)
            .post("/system-settings/test-navidrome")
            .set("Authorization", `Bearer ${token()}`)
            .send({ url: "http://navidrome:4533" });
        expect(res.status).toBe(400);
    });

    it("returns success when the connection works", async () => {
        (navidromeSync.testConnection as jest.Mock).mockResolvedValue({ ok: true });
        const app = makeApp();
        const res = await request(app)
            .post("/system-settings/test-navidrome")
            .set("Authorization", `Bearer ${token()}`)
            .send({ url: "http://navidrome:4533", username: "robert", password: "secret" });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(navidromeSync.testConnection).toHaveBeenCalledWith(
            "http://navidrome:4533",
            "robert",
            "secret"
        );
    });

    it("maps connection failures to 502 with the error message", async () => {
        (navidromeSync.testConnection as jest.Mock).mockResolvedValue({
            ok: false,
            error: "Navidrome getPlaylists failed: 401",
        });
        const app = makeApp();
        const res = await request(app)
            .post("/system-settings/test-navidrome")
            .set("Authorization", `Bearer ${token()}`)
            .send({ url: "http://navidrome:4533", username: "robert", password: "wrong" });
        expect(res.status).toBe(502);
        expect(res.body.error).toContain("401");
    });
});

describe("POST /system-settings/navidrome-sync/now", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: "u-1",
            username: "admin",
            role: "admin",
            tokenVersion: 1,
        });
        (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(null);
    });

    it("returns 400 when sync is not configured/enabled", async () => {
        (getSystemSettings as jest.Mock).mockResolvedValue({
            navidromeSyncEnabled: false,
            navidromeUrl: "http://navidrome:4533",
            navidromeUser: "robert",
            navidromePassword: "secret",
        });
        const app = makeApp();
        const res = await request(app)
            .post("/system-settings/navidrome-sync/now")
            .set("Authorization", `Bearer ${token()}`);
        expect(res.status).toBe(400);
        expect(navidromeSync.syncAll).not.toHaveBeenCalled();
    });

    it("runs syncAll when configured and returns its results", async () => {
        (getSystemSettings as jest.Mock).mockResolvedValue(CONFIGURED);
        (navidromeSync.syncAll as jest.Mock).mockResolvedValue([
            { playlistId: "p1", name: "Road Trip", status: "synced" },
        ]);
        const app = makeApp();
        const res = await request(app)
            .post("/system-settings/navidrome-sync/now")
            .set("Authorization", `Bearer ${token()}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.results).toHaveLength(1);
        expect(navidromeSync.syncAll).toHaveBeenCalledTimes(1);
    });

    it("syncs the given playlist ids when provided", async () => {
        (getSystemSettings as jest.Mock).mockResolvedValue(CONFIGURED);
        (navidromeSync.syncPlaylist as jest.Mock).mockResolvedValue({
            playlistId: "p9",
            name: "Nine",
            status: "synced",
        });
        const app = makeApp();
        const res = await request(app)
            .post("/system-settings/navidrome-sync/now")
            .set("Authorization", `Bearer ${token()}`)
            .send({ playlistIds: ["p9"] });
        expect(res.status).toBe(200);
        expect(navidromeSync.syncPlaylist).toHaveBeenCalledWith("p9");
        expect(navidromeSync.syncAll).not.toHaveBeenCalled();
    });
});
