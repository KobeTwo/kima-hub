# Agent Guide — kima-hub (Personal Fork)

## Project Overview

This is a personal fork of [Chevron7Locked/kima-hub](https://github.com/Chevron7Locked/kima-hub), a self-hosted music streaming platform. AI features and audio analysis have been removed from this fork.

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS 4, Bun
- **Backend**: Express.js, TypeScript, Prisma ORM
- **Database**: PostgreSQL (pgvector disabled — was used for vibe embeddings)
- **Cache/Queues**: Redis, BullMQ
- **3D/Visualization**: deck.gl, react-three-fiber, three.js
- **Styling**: Tailwind CSS 4 (CSS-based, no config file), CSS variables for theming

## Key Commands

### Frontend
```bash
cd frontend
bun install          # install dependencies
bun run dev          # dev server on :3030
bun run build        # production build
bun run lint         # ESLint
bun run typecheck    # TypeScript check
bun run test:unit    # vitest unit tests
bun run test:e2e    # playwright e2e tests
```

### Backend
```bash
cd backend
npm install          # install dependencies
npm run dev          # tsx watch (auto-restart)
npm run build        # tsc compile
npm run typecheck    # TypeScript check
npm run test         # jest tests
npm run db:migrate   # prisma migrate deploy
npm run db:studio    # prisma studio (browser DB viewer)
npm run seed:user    # create a user
```

### Docker Compose
```bash
docker compose -f docker-compose.dev.yml up      # dev (hot reload)
docker compose -f docker-compose.yml up          # production
```

## Architecture

```
Browser → Next.js (port 3030) → Express API (port 3006) → PostgreSQL / Redis
```

- Frontend and backend run as separate processes.
- API requests from the frontend go to `/api/*` (Next.js rewrites them to port 3006).
- Session auth via Redis; JWT for API tokens.

## Hard Rules

- **Do not re-add**: vibe embeddings, CLAP audio analysis, MusiCNN mood/BPM detection, audio analyzer services, or any feature listed in `docs/skip-features.md`.
- **Do not add AI features** (OpenAI, LLM, embeddings for recommendations, etc.).
- Keep local changes personal. Do not open PRs to upstream unless explicitly requested.
- Run `bun run typecheck && bun run lint` (frontend) or `npm run typecheck` (backend) before marking work complete.
- Tests should pass. Run relevant tests after changes.

## Detailed Conventions

See the `docs/` directory for detailed guidance:

- `docs/frontend-conventions.md` — component patterns, Tailwind usage, React Query, deck.gl/three.js
- `docs/backend-conventions.md` — Express routes, Prisma, BullMQ jobs, middleware
- `docs/development-workflow.md` — local setup, migrations, seeding, testing
- `docs/skip-features.md` — removed features and why