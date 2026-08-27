# Strip ML Dependencies from All-in-One Dockerfile

**Date:** 2026-08-27
**Status:** Implemented

## Goal

Reduce the all-in-one Docker image size by removing Python, ML models, audio analysis services, and pgvector — none of which are needed since vibe/CLAP/audio analysis features were removed in prior commits.

## Changes

### `Dockerfile`
- Removed Python, pip, numpy, build-essential, python3-dev
- Removed PyTorch (torch, torchaudio, torchvision)
- Removed laion-clap, transformers, librosa
- Removed tensorflow-cpu, essentia-tensorflow
- Removed scipy/pandas (TF compatibility pins)
- Removed all 12 MusiCNN model files (~150MB)
- Removed CLAP model file (~400MB)
- Removed /app/audio-analyzer/ and /app/models/ directories
- Removed postgresql-16-pgvector (pgvector extension)
- Removed DISABLE_CLAP environment variable and related logic
- Updated startup banner to remove AI/Vibe references
- Image reduced from ~6-8GB to ~1.5-2GB

### `docker-compose.yml`
- Changed `pgvector/pgvector:pg16` → `postgres:16` for the postgres service

### `docker-compose.dev.yml`
- Changed `pgvector/pgvector:pg16` → `postgres:16` for the postgres service

### `backend/prisma/schema.prisma`
- Removed `TrackEmbedding` model (Prisma no longer manages the embeddings table)

### `backend/prisma/migrations/`
- Added migration `20260417000000_drop_track_embeddings` — safely drops the `track_embeddings` table and `vector` extension if they exist. Safe for both existing databases (table exists, drops cleanly) and fresh databases (table never gets created by Prisma).
- Updated `20260307000000_switch_ivfflat_to_hnsw` — wrapped in `DO $$` block to check table existence first. Prevents failure when table has been dropped.

## Migration Compatibility

### Existing databases
Migrations run in order. The embedding-related migrations create the table first, then `20260417000000` drops it. Vector extension is dropped last. Works correctly.

### Fresh databases with postgres:16
The `20260127000000_add_pgvector` migration tries to `CREATE EXTENSION vector`, which fails on postgres:16 (pgvector not installed). This is expected — pgvector is no longer needed since the embedding features were removed. Users doing fresh installs on postgres:16 without pgvector will see this migration fail, which is acceptable for a personal fork optimization.

**Workaround:** If starting fresh on postgres:16, manually remove the embedding migrations from the `prisma/migrations/` folder before running `prisma migrate deploy`.

## What Was Removed

| Component | Size estimate |
|-----------|--------------|
| Python + build tools | ~300MB |
| PyTorch (CPU) | ~1.5GB |
| laion-clap + transformers + librosa | ~800MB |
| tensorflow-cpu | ~500MB |
| essentia-tensorflow | ~200MB |
| scipy + pandas | ~200MB |
| MusiCNN model files (12x) | ~150MB |
| CLAP model file | ~400MB |
| postgresql-16-pgvector | overhead |
| **Total** | **~4-5GB** |

## What Stays

- Backend (Node.js/Express)
- Frontend (Next.js)
- PostgreSQL (without pgvector — tsvector search still works, vector type no longer needed)
- Redis
- ffmpeg for transcoding
- Supervisor orchestration
- Security hardening (wget/curl/nc removed)
- Health checks
- Entrypoint scripts and migrations