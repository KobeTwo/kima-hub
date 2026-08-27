# Backend Conventions

## Routes

### Structure

One file per resource in `src/routes/`. Complex routes use subdirectories with an `index.ts` that re-exports. Export `Router` as default.

```typescript
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../utils/db";
import { logger } from "../utils/logger";
import { z } from "zod";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const data = await prisma.model.findMany();
    res.json(data);
  } catch (error) {
    logger.error("Get error:", error);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
```

### Registration

All routes registered under `/api` prefix in `src/index.ts`. Rate limiters applied per-route:

```typescript
app.use("/api/auth", authRoutes);
app.use("/api/library", apiLimiter, libraryRoutes);
```

High-traffic endpoints (streaming, cover-art) skip rate limiting.

### Validation

Use Zod for request validation. Check `req.body`, `req.query`, and `req.params`.

```typescript
const createSchema = z.object({ name: z.string().min(1) });

router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
  }
  // ...
});
```

## Services

### Pattern

One class per domain in `src/services/`. Export a singleton instance.

```typescript
export class SearchService {
  async search(query: string): Promise<Result[]> {
    try {
      return await prisma.$queryRaw<Result[]>`SELECT ...`;
    } catch (error) {
      logger.error("Search error:", error);
      return this.fallbackSearch(query);
    }
  }
}

export const searchService = new SearchService();
```

### Key Patterns

- Use TypeScript interfaces for request/response types
- Implement fallback methods for graceful degradation
- Cache expensive operations in Redis with TTL
- Use `$queryRaw` with tagged template literals for complex queries (type-safe)

## Jobs (BullMQ)

### Queue Definition

```typescript
import { Queue } from "bullmq";

export const scanQueue = new Queue("library-scan-v2", {
  connection: getConnectionOptions(),
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 5000 },
  },
});
```

### Worker Pattern

```typescript
const scanWorker = new Worker("library-scan-v2", async (job) => {
  // process job
}, {
  connection: createWorkerConnection(),
  concurrency: 1,
  lockDuration: 300000,
});

scanWorker.on("completed", (job, result) => { /* log */ });
scanWorker.on("failed", (job, err) => { /* handle */ });
```

### Conventions

- Queue names use `v2` suffix to avoid Redis key conflicts
- No colons in queue names (BullMQ v5 requirement) — use hyphens
- Event handlers for `completed`, `failed`, `active`, `error`
- Graceful shutdown via `worker.close()` and `queue.close()`

## Prisma

### Schema Conventions

- `cuid()` default for IDs: `id String @id @default(cuid())`
- Snake_case column names (PostgreSQL convention)
- Model names: PascalCase
- Cascade deletes: `onDelete: Cascade`
- Custom table names: `@@map("table_name")`
- Indexes for common filter patterns

### Key Models

See `backend/prisma/schema.prisma` for the full schema. Common models: `User`, `Artist`, `Album`, `Track`, `Playlist`, `Podcast`, `Audiobook`.

## Middleware

### Auth

```typescript
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await authenticateRequest(req, false);
  if (user) { req.user = user; return next(); }
  return res.status(401).json({ error: "Not authenticated" });
}
```

### User Type

Extend `Express.Request` in middleware files:

```typescript
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; username: string; role: string; };
    }
  }
}
```

## Error Handling

### Pattern

```typescript
try {
  const data = await prisma.model.findMany();
  res.json(data);
} catch (err) {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: "Invalid request", details: err.errors });
  }
  if ((err as any).code === "P2025") {
    return res.status(404).json({ error: "Not found" });
  }
  logger.error("Handler error:", err);
  res.status(500).json({ error: "Internal error" });
}
```

### Utilities

- `safeError(res, context, error)` — logs and returns 500
- Custom error classes in `src/utils/errors.ts`: `AppError`, `UserFacingError`, `IntegrationError`, `RateLimitError`

## Key Utilities

| File | Purpose |
|------|---------|
| `utils/db.ts` | Prisma client singleton |
| `utils/redis.ts` | Redis client with auto-reconnect |
| `utils/logger.ts` | Winston-based structured logging |
| `utils/errors.ts` | Custom error classes |
| `config.ts` | Environment config with validation |

## Key Dependencies

| Package | Use |
|---------|-----|
| `zod` | Schema validation |
| `axios` | HTTP requests |
| `bcrypt` | Password hashing |
| `fast-xml-parser` | Subsonic API responses |
| `fluent-ffmpeg` | Audio transcoding |
| `music-metadata` | Audio file metadata parsing |
| `sharp` | Image processing |
| `rss-parser` | Podcast RSS feeds |
| `qrcode` | QR code generation |
| `ioredis` | Redis client |
| `bullmq` | Job queues |
| `p-limit`, `p-queue` | Concurrency control |