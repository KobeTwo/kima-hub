# Development Workflow

## Local Setup

### Prerequisites

- Docker and Docker Compose
- Bun (for frontend)
- Node.js 20+ (for backend)
- PostgreSQL 16 with pgvector extension (via Docker)
- Redis (via Docker)

### Docker Compose (Development)

```bash
docker compose -f docker-compose.dev.yml up
```

This starts all services with hot reload enabled:
- Frontend at `http://localhost:3030`
- Backend at `http://localhost:3006`
- PostgreSQL at port `5432`
- Redis at port `6379`

### Manual (No Docker)

#### Backend

```bash
cd backend
npm install
npm run dev
```

Requires PostgreSQL and Redis running. Copy `.env` from `.env.example` and fill in connection strings.

#### Frontend

```bash
cd frontend
bun install
bun run dev
```

Frontend proxies API requests to `http://localhost:3006`.

## Database

### Migrations

```bash
cd backend
npm run db:migrate        # deploy pending migrations
npm run db:studio         # open Prisma Studio (browser UI)
```

### Creating a User

```bash
cd backend
npm run seed:user
```

This starts an interactive prompt to create a user. The first user becomes admin.

## Building

### Frontend

```bash
cd frontend
bun run build       # production build
bun run analyze     # bundle analysis
```

### Backend

```bash
cd backend
npm run build       # tsc compile → dist/
npm run start       # run production build
```

## Testing

### Frontend

```bash
cd frontend
bun run lint            # ESLint
bun run typecheck       # TypeScript check
bun run test:unit        # vitest unit tests
bun run test:e2e         # playwright e2e tests
bun run test:predeploy   # critical path e2e tests
```

### Backend

```bash
cd backend
npm run typecheck    # TypeScript check
npm run test         # jest unit tests
npm run test:smoke   # smoke tests
```

### E2E Testing (Playwright)

```bash
cd frontend
bun run test:e2e                  # headless
bun run test:ee2:ui              # with UI
bun run test:e2e:headed          # headed browser
```

## Lint & Typecheck

Always run before marking work complete:

```bash
# Frontend
cd frontend && bun run lint && bun run typecheck

# Backend
cd backend && npm run typecheck
```

## Workflow Summary

1. **Start services**: `docker compose -f docker-compose.dev.yml up`
2. **Make changes** to frontend or backend
3. **Run checks**: `bun run lint && bun run typecheck` (frontend) or `npm run typecheck` (backend)
4. **Run tests**: `bun run test:unit` (frontend) or `npm run test` (backend)
5. **Build**: `bun run build` (frontend) or `npm run build` (backend)

## Environment Variables

Copy `.env.example` to `.env` in both `frontend/` and `backend/` directories. Key variables:

| Variable | Backend Default | Description |
|----------|----------------|-------------|
| `DATABASE_URL` | `postgresql://...` | PostgreSQL connection string |
| `REDIS_URL` | `redis://...` | Redis connection string |
| `SESSION_SECRET` | (generate) | Session encryption key |
| `SETTINGS_ENCRYPTION_KEY` | (required) | Encryption key for stored credentials |
| `PORT` | `3006` | API server port |

| Variable | Frontend Default | Description |
|----------|-----------------|-------------|
| `NEXT_PUBLIC_API_URL` | (unset) | Override API URL (for reverse proxy setups) |