# Kima All-in-One Docker Image (Hardened, No ML)
# Contains: Backend, Frontend, PostgreSQL, Redis
# No Python, no ML, no audio analysis.

FROM node:22-slim

# Add PostgreSQL 16 repository (Debian Bookworm only has PG15 by default)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gnupg lsb-release curl ca-certificates && \
    echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg && \
    apt-get update

RUN apt-get install -y --no-install-recommends \
    postgresql-16 \
    postgresql-contrib-16 \
    redis-server \
    supervisor \
    ffmpeg \
    tini \
    openssl \
    bash \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Create directories
RUN mkdir -p /app/backend /app/frontend /data/postgres /data/redis /run/postgresql /var/log/supervisor \
    && chown -R postgres:postgres /data/postgres /run/postgresql

# Create database readiness check script
RUN cat > /app/wait-for-db.sh << 'EOF'
#!/bin/bash
TIMEOUT=${1:-120}
COUNTER=0

echo "[wait-for-db] Waiting for Redis and database schema (timeout: ${TIMEOUT}s)..."

echo "[wait-for-db] Checking Redis readiness..."
REDIS_COUNTER=0
while [ $REDIS_COUNTER -lt $TIMEOUT ]; do
    if redis-cli -h localhost ping 2>/dev/null | grep -q PONG; then
        echo "[wait-for-db] ✓ Redis is ready!"
        break
    fi
    sleep 1
    REDIS_COUNTER=$((REDIS_COUNTER + 1))
done

if [ $REDIS_COUNTER -ge $TIMEOUT ]; then
    echo "[wait-for-db] ERROR: Redis not ready after ${TIMEOUT}s"
    exit 1
fi

if [ -f /data/.schema_ready ]; then
    echo "[wait-for-db] Schema ready flag found, verifying connection..."
fi

while [ $COUNTER -lt $TIMEOUT ]; do
    if PGPASSWORD=kima psql -h localhost -U kima -d kima -c "SELECT 1 FROM \"Track\" LIMIT 1" > /dev/null 2>&1; then
        echo "[wait-for-db] ✓ Database is ready and schema exists!"
        exit 0
    fi

    if [ $((COUNTER % 15)) -eq 0 ]; then
        echo "[wait-for-db] Still waiting... (${COUNTER}s elapsed)"
    fi

    sleep 1
    COUNTER=$((COUNTER + 1))
done

echo "[wait-for-db] ERROR: Database schema not ready after ${TIMEOUT}s"
echo "[wait-for-db] Listing available tables:"
PGPASSWORD=kima psql -h localhost -U kima -d kima -c "\dt" 2>&1 || echo "Could not list tables"
exit 1
EOF

RUN chmod +x /app/wait-for-db.sh && \
    sed -i 's/\r$//' /app/wait-for-db.sh

# ============================================
# BACKEND BUILD
# ============================================
WORKDIR /app/backend

COPY backend/package*.json ./
COPY backend/prisma ./prisma/
RUN echo "=== Migrations copied ===" && ls -la prisma/migrations/ && echo "=== End migrations ==="
RUN npm ci && npm cache clean --force
RUN npx prisma generate

COPY backend/src ./src
COPY backend/tsconfig.json ./
RUN npm run build && \
    npm prune --production && \
    rm -rf src tests __tests__ tsconfig*.json

COPY backend/docker-entrypoint.sh ./
COPY backend/healthcheck.js ./healthcheck-backend.js

RUN mkdir -p /app/backend/logs

# ============================================
# FRONTEND BUILD
# ============================================
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci && npm cache clean --force

COPY frontend/ ./

ENV NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:3006
RUN MALLOC_ARENA_MAX=1 NODE_OPTIONS="--max-old-space-size=2048" npm run build

# ============================================
# SECURITY HARDENING
# ============================================
RUN apt-get purge -y --auto-remove 2>/dev/null || true && \
    rm -f /usr/bin/wget /bin/wget 2>/dev/null || true && \
    rm -f /usr/bin/curl /bin/curl 2>/dev/null || true && \
    rm -f /usr/bin/nc /bin/nc /usr/bin/ncat /usr/bin/netcat 2>/dev/null || true && \
    rm -f /usr/bin/ftp /usr/bin/tftp /usr/bin/telnet 2>/dev/null || true && \
    rm -rf /var/lib/apt/lists/*

# ============================================
# CONFIGURATION
# ============================================
WORKDIR /app

COPY healthcheck-prod.js /app/healthcheck.js

RUN cat > /etc/supervisor/conf.d/kima.conf << 'EOF'
[supervisord]
nodaemon=true
logfile=/dev/null
logfile_maxbytes=0
pidfile=/var/run/supervisord.pid
user=root

[program:postgres]
command=/usr/lib/postgresql/16/bin/postgres -D /data/postgres
user=postgres
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
priority=10

[program:redis]
command=/usr/bin/redis-server --dir /data/redis --appendonly yes
user=redis
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
priority=20

[program:backend]
command=/bin/bash -c "/app/wait-for-db.sh 120 && cd /app/backend && node dist/index.js"
environment=TZ="UTC"
autostart=true
autorestart=true
startretries=3
startsecs=10
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
directory=/app/backend
priority=30

[program:frontend]
command=/bin/bash -c "sleep 10 && cd /app/frontend && npm start"
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
environment=NODE_ENV="production",BACKEND_URL="http://localhost:3006",PORT="3030",MALLOC_ARENA_MAX="1",NODE_OPTIONS="--max-old-space-size=512",TZ="UTC"
priority=40
EOF

RUN sed -i 's/\r$//' /etc/supervisor/conf.d/kima.conf

RUN cat > /app/start.sh << 'EOF'
#!/bin/bash
set -e

echo ""
echo "============================================================"
echo "  Kima - Self-Hosted Music Server"
echo ""
echo "  Features:"
echo "    - High-Quality Audio Streaming"
echo "    - Smart Playlists & Radio"
echo "    - Multi-User Support"
echo ""
echo "  Security:"
echo "    - Hardened container (no wget/curl/nc)"
echo "    - Auto-generated encryption keys"
echo "============================================================"
echo ""

PG_BIN=$(find /usr/lib/postgresql -name "bin" -type d | head -1)
if [ -z "$PG_BIN" ]; then
    echo "ERROR: PostgreSQL binaries not found!"
    exit 1
fi
echo "Using PostgreSQL from: $PG_BIN"

echo "Preparing data directories..."
mkdir -p /data/postgres /data/redis /run/postgresql

if id postgres >/dev/null 2>&1; then
    chown -R postgres:postgres /data/postgres /run/postgresql 2>/dev/null || true
    chmod 700 /data/postgres 2>/dev/null || true
    if ! gosu postgres test -w /data/postgres; then
        POSTGRES_UID=$(id -u postgres)
        POSTGRES_GID=$(id -g postgres)
        echo "ERROR: /data/postgres is not writable by postgres (${POSTGRES_UID}:${POSTGRES_GID})."
        echo "If you bind-mount /data, ensure the host path is writable by that UID/GID."
        exit 1
    fi
fi

if id redis >/dev/null 2>&1; then
    chown -R redis:redis /data/redis 2>/dev/null || true
    chmod 700 /data/redis 2>/dev/null || true
    if ! gosu redis test -w /data/redis; then
        REDIS_UID=$(id -u redis)
        REDIS_GID=$(id -g redis)
        echo "ERROR: /data/redis is not writable by redis (${REDIS_UID}:${REDIS_GID})."
        echo "If you bind-mount /data, ensure the host path is writable by that UID/GID."
        exit 1
    fi
fi

rm -f /data/postgres/postmaster.pid 2>/dev/null || true

if [ ! -f /data/postgres/PG_VERSION ]; then
    echo "Initializing PostgreSQL database..."
    gosu postgres $PG_BIN/initdb -D /data/postgres

    echo "host all all 0.0.0.0/0 md5" >> /data/postgres/pg_hba.conf
    echo "listen_addresses='*'" >> /data/postgres/postgresql.conf
fi

gosu postgres $PG_BIN/pg_ctl -D /data/postgres -w start

if gosu postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'lidify'" | grep -q 1; then
    echo "Found legacy 'lidify' database, migrating to 'kima'..."
    gosu postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'lidify' AND pid <> pg_backend_pid();" 2>/dev/null || true
    gosu postgres psql -c "ALTER DATABASE lidify RENAME TO kima;"
    echo "✓ Database renamed: lidify -> kima"
    if gosu postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname = 'lidify'" | grep -q 1; then
        gosu postgres psql -c "ALTER USER lidify RENAME TO kima;"
        gosu postgres psql -c "ALTER USER kima WITH PASSWORD 'kima';"
        echo "✓ User renamed: lidify -> kima"
    fi
fi

gosu postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname = 'kima'" | grep -q 1 || \
    gosu postgres psql -c "CREATE USER kima WITH PASSWORD 'kima';"
gosu postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'kima'" | grep -q 1 || \
    gosu postgres psql -c "CREATE DATABASE kima OWNER kima;"

cd /app/backend
export DATABASE_URL="postgresql://kima:kima@localhost:5432/kima"
echo "Running Prisma migrations..."
ls -la prisma/migrations/ || echo "No migrations directory!"

MIGRATIONS_EXIST=$(gosu postgres psql -d kima -tAc "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '_prisma_migrations')" 2>/dev/null || echo "f")
USER_TABLE_EXIST=$(gosu postgres psql -d kima -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='SystemSettings' AND column_name='soulseekFallback');" 2>/dev/null || echo "f")

if gosu postgres psql -d kima -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='SystemSettings' AND column_name='soulseekFallback');" 2>/dev/null | grep -q 't'; then
    echo "Old column exists, marking migration as applied..."
    gosu postgres psql -d kima -c "INSERT INTO \"_prisma_migrations\" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (gen_random_uuid(), '', NOW(), '20250101000000_rename_soulseek_fallback', '', NULL, NOW(), 1) ON CONFLICT DO NOTHING;" 2>/dev/null || true
fi

if [ "$MIGRATIONS_EXIST" = "t" ]; then
    echo "Migration history found, running migrate deploy..."
    if ! npx prisma migrate deploy 2>&1; then
        echo "FATAL: Database migration failed! Check logs above."
        exit 1
    fi
elif [ "$USER_TABLE_EXIST" = "t" ]; then
    echo "Existing database detected without migration history."
    echo "Creating baseline from current schema..."
    npx prisma migrate resolve --applied 20241130000000_init 2>&1 || true
    if ! npx prisma migrate deploy 2>&1; then
        echo "FATAL: Migration after baseline failed!"
        exit 1
    fi
else
    echo "Fresh database detected, running initial migrations..."
    if ! npx prisma migrate deploy 2>&1; then
        echo "FATAL: Initial migration failed. Check database connection and schema."
        exit 1
    fi
fi
echo "✓ Migrations completed successfully"

echo "Verifying database schema..."
if ! gosu postgres psql -d kima -c "SELECT 1 FROM \"Track\" LIMIT 1" >/dev/null 2>&1; then
    echo "FATAL: Track table does not exist after migration!"
    echo "Database schema verification failed. Container will exit."
    exit 1
fi
echo "✓ Schema verification passed"

touch /data/.schema_ready
echo "✓ Schema ready flag created"

gosu postgres $PG_BIN/pg_ctl -D /data/postgres -w stop

mkdir -p /data/cache/covers /data/cache/transcodes /data/secrets

if [ -f /data/secrets/session_secret ]; then
    SESSION_SECRET=$(cat /data/secrets/session_secret)
    echo "Loaded existing SESSION_SECRET"
else
    SESSION_SECRET=$(openssl rand -hex 32)
    echo "$SESSION_SECRET" > /data/secrets/session_secret
    chmod 600 /data/secrets/session_secret
    echo "Generated and saved new SESSION_SECRET"
fi

if [ -f /data/secrets/encryption_key ]; then
    SETTINGS_ENCRYPTION_KEY=$(cat /data/secrets/encryption_key)
    echo "Loaded existing SETTINGS_ENCRYPTION_KEY"
else
    SETTINGS_ENCRYPTION_KEY=$(openssl rand -hex 32)
    echo "$SETTINGS_ENCRYPTION_KEY" > /data/secrets/encryption_key
    chmod 600 /data/secrets/encryption_key
    echo "Generated and saved new SETTINGS_ENCRYPTION_KEY"
fi

cat > /app/backend/.env << ENVEOF
NODE_ENV=production
DATABASE_URL=postgresql://kima:kima@localhost:5432/kima
REDIS_URL=redis://localhost:6379
PORT=3006
MUSIC_PATH=/music
TRANSCODE_CACHE_PATH=/data/cache/transcodes
SESSION_SECRET=$SESSION_SECRET
SETTINGS_ENCRYPTION_KEY=$SETTINGS_ENCRYPTION_KEY
INTERNAL_API_SECRET=kima-internal-aio
ENVEOF

echo "Starting Kima..."
exec env \
    NODE_ENV=production \
    DATABASE_URL="postgresql://kima:kima@localhost:5432/kima" \
    SESSION_SECRET="$SESSION_SECRET" \
    SETTINGS_ENCRYPTION_KEY="$SETTINGS_ENCRYPTION_KEY" \
    /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
EOF

RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh

EXPOSE 3030

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ["node", "/app/healthcheck.js"]

VOLUME ["/music", "/data"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/start.sh"]