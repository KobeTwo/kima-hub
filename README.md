# kima-hub

[![Docker Image](https://img.shields.io/docker/v/chevron7locked/kima?label=Docker&sort=semver)](https://hub.docker.com/r/chevron7locked/kima)
[![GitHub Release](https://img.shields.io/github/v/release/Chevron7Locked/kima-hub?label=Release)](https://github.com/Chevron7Locked/kima-hub/releases)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

A self-hosted music library manager that brings curation, discovery, and download power to your personal music collection.

Kima is built for music lovers who want to own their library. Point it at your music collection, and Kima handles the rest: artist discovery, personalized playlists, and seamless integration with tools you already use like Lidarr. Kima focuses on downloading, metadata, and library curation — for playing your music, pair it with your favorite player (e.g. Navidrome).

![Kima Home Screen](assets/screenshots/desktop-home.png)

---

## A Note on Native Apps

Once the core experience is solid and properly tested, a native mobile app (likely React Native) is on the roadmap. The PWA works great for most cases for now.

Thanks for your patience while I work through this.

---

## Table of Contents

-   [Features](#features)
    -   [Mood Mixer](#mood-mixer)
    -   [Playlist Import](#playlist-import)
-   [Mobile Support](#mobile-support)
-   [Quick Start](#quick-start)
-   [Configuration](#configuration)
-   [CLAP Audio Analysis](#clap-audio-analysis)
-   [GPU Acceleration](#gpu-acceleration)
-   [Integrations](#integrations)
-   [Using Kima](#using-kima)
    -   [Mood Mixer](#mood-mixer-1)
-   [Administration](#administration)
-   [Architecture](#architecture)
-   [Roadmap](#roadmap)
-   [License](#license)
-   [Acknowledgments](#acknowledgments)

---

## Features

### Your Music, Your Way

-   **Downloads** - Acquire new music through Lidarr or Soulseek; Kima handles the download, import, and enrichment end to end
-   **Automatic cataloging** - Kima scans your library and enriches it with metadata from MusicBrainz and Last.fm, including ISRC codes and genre tags
-   **Ultra-wide support** - Library grid scales up to 8 columns on large displays

<p align="center">
  <img src="assets/screenshots/desktop-library.png" alt="Library View" width="800">
</p>

### Discovery and Playlists

-   **Made For You mixes** - Programmatically generated playlists based on your library:
    -   Era mixes (Your 90s, Your 2000s, etc.)
    -   Genre mixes
    -   Top tracks
    -   Rediscover forgotten favorites
    -   Similar artist recommendations
-   **Discover Weekly** - Weekly playlists of new music, auto-downloaded through Lidarr
-   **Artist recommendations** - Find similar artists based on what you already love
-   **Artist name resolution** - Smart alias lookup via Last.fm (e.g., "of mice" → "Of Mice & Men")
-   **Discography sorting** - Sort artist albums by year or date added
-   **Deezer previews** - Preview tracks you don't own before adding them to your library

### Mood Mixer

Pick a mood preset (Happy, Energetic, Chill, Focus, Party, Acoustic, Melancholic, Sad, Aggressive) to instantly generate a playlist calibrated to that sound. Moods are derived from audio analysis of your actual library (mood buckets), not genre tags. Each preset shows how many tracks in your library match that mood.

<p align="center">
  <img src="assets/screenshots/mood-mixer.png" alt="Mood Mixer" width="800">
</p>

### Playlist Import

Import playlists from Spotify, Deezer, and YouTube, or browse and discover new music directly.

-   **Spotify Import** - Paste any Spotify playlist URL to import tracks
-   **Deezer Import** - Same functionality for Deezer playlists
-   **YouTube Import** - Import from YouTube and YouTube Music playlists
-   **ISRC Matching** - Deterministic track matching via International Standard Recording Codes before falling back to fuzzy text matching
-   **Smart Preview** - See which tracks are already in your library, which albums can be downloaded, and which have no matches
-   **Selective Download** - Choose exactly which albums to add to your library
-   **Browse Deezer** - Explore Deezer's featured playlists and radio stations directly in-app

<p align="center">
  <img src="assets/screenshots/deezer-browse.png" alt="Browse Deezer" width="800">
</p>
<p align="center">
  <img src="assets/screenshots/spotify-import-preview.png" alt="Import Preview" width="800">
</p>

### Multi-User Support

-   **Separate accounts** - Each user gets their own playlists, mixes, and preferences
-   **Admin controls** - Manage users and system settings from the web interface
-   **Two-factor authentication** - Secure accounts with TOTP-based 2FA

### Custom Playlists

-   **Create and curate** - Build your own playlists from your library
-   **Share with others** - Make playlists public for other users on your instance
-   **Save mixes** - Convert any auto-generated mix into a permanent playlist

### Mobile and TV

-   **Progressive Web App (PWA)** - Install Kima on your phone or tablet for a native-like experience
-   **Android TV** - Fully optimized 10-foot interface with D-pad/remote navigation
-   **Responsive Web** - Works on any device with a modern browser

<p align="center">
  <img src="assets/screenshots/mobile-home.png" alt="Mobile Home" width="280">
  <img src="assets/screenshots/mobile-library.png" alt="Mobile Library" width="280">
</p>

---

## Mobile Support

### Progressive Web App (PWA)

Kima works as a PWA on mobile devices, giving you a native app-like experience without needing to download from an app store.

**To install on Android:**

1. Open your Kima server in Chrome
2. Tap the menu (⋮)
3. Select "Add to Home Screen" or "Install app"

**To install on iOS:**

1. Open your Kima server in Safari
2. Tap the Share button
3. Select "Add to Home Screen"

**PWA Features:**

-   Offline caching for faster loads
-   Installable icon on home screen

### Android TV

Kima includes a dedicated interface optimized for television displays:

-   Large artwork and readable text from across the room
-   Full D-pad and remote navigation support
-   Simplified navigation focused on browsing and curation

The TV interface is automatically enabled when accessing Kima from an Android TV device's browser.

---

## Quick Start

### One Command Install

```bash
docker run -d \
  --name kima \
  -p 3030:3030 \
  -v /path/to/your/music:/music \
  -v kima_data:/data \
  chevron7locked/kima:latest
```

That's it! Open http://localhost:3030 and create your account.

**With GPU acceleration** (requires [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)):

```bash
docker run -d \
  --name kima \
  --gpus all \
  -p 3030:3030 \
  -v /path/to/your/music:/music \
  -v kima_data:/data \
  chevron7locked/kima:latest
```

### What's Included

The Kima container includes everything you need:

-   **Web Interface** (port 3030)
-   **API Server** (internal)
-   **PostgreSQL Database** (internal)
-   **Redis Cache** (internal)

### Configuration Options

```bash
docker run -d \
  --name kima \
  -p 3030:3030 \
  -v /path/to/your/music:/music \
  -v kima_data:/data \
  -e SESSION_SECRET=your-secret-key \
  -e TZ=America/New_York \
  --add-host=host.docker.internal:host-gateway \
  chevron7locked/kima:latest
```

| Variable         | Description            | Default        |
| ---------------- | ---------------------- | -------------- |
| `SESSION_SECRET` | Session encryption key | Auto-generated |
| `TZ`             | Timezone               | UTC            |

### Using Docker Compose

Create a `docker-compose.yml` file:

```yaml
services:
    kima:
        image: chevron7locked/kima:latest
        container_name: kima
        ports:
            - "3030:3030"
        volumes:
            - /path/to/your/music:/music
            - kima_data:/data
        environment:
            - TZ=America/New_York
        # Required for Lidarr webhook integration on Linux
        extra_hosts:
            - "host.docker.internal:host-gateway"
        restart: unless-stopped

volumes:
    kima_data:
```

Then run:

```bash
docker compose up -d
```

**Updating with Docker Compose:**

```bash
docker compose pull
docker compose up -d
```

### Bind-mounting `/data` on Linux

Named volumes are recommended. If you bind-mount `/data`, make sure required subdirectories exist and are writable by the container service users.

```bash
mkdir -p /path/to/kima-data/postgres /path/to/kima-data/redis
```

If startup logs report a permission error, `chown` the host path to the UID/GID shown in the logs (for example, the postgres user).

---

Kima will begin scanning your music library automatically. Depending on the size of your collection, this may take a few minutes to several hours.

---

## Release Channels

Kima offers two release channels to match your stability preferences:

### 🟢 Stable (Recommended)

Production-ready releases. Updated when new stable versions are released.

```bash
docker pull chevron7locked/kima:latest
# or specific version
docker pull chevron7locked/kima:v1.7.3
```

### 🔴 Nightly (Development)

Latest development build. Built on every push to main.

⚠️ **Not recommended for production** - may be unstable or broken.

```bash
docker pull chevron7locked/kima:nightly
```

**For contributors:** See [`CONTRIBUTING.md`](CONTRIBUTING.md) for information on submitting pull requests and contributing to Kima.

---

## Configuration

### Environment Variables

The unified Kima container handles most configuration automatically. Here are the available options:

| Variable                            | Default                            | Description                                                                 |
| ----------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| `SESSION_SECRET`                    | Auto-generated                     | Session encryption key (recommended to set for persistence across restarts) |
| `SETTINGS_ENCRYPTION_KEY`           | Required                           | Encryption key for stored credentials (generate with `openssl rand -base64 32`) |
| `TZ`                                | `UTC`                              | Timezone for the container                                                  |
| `PORT`                              | `3030`                             | Port to access Kima                                                       |
| `KIMA_CALLBACK_URL`               | `http://host.docker.internal:3030` | URL for Lidarr webhook callbacks (see [Lidarr integration](#lidarr))        |
| `AUDIO_ANALYSIS_WORKERS`            | `2`                                | Number of parallel workers for audio analysis (1-8)                         |
| `AUDIO_ANALYSIS_THREADS_PER_WORKER` | `1`                                | Threads per worker for TensorFlow/FFT operations (1-4)                      |
| `AUDIO_ANALYSIS_BATCH_SIZE`         | `10`                               | Tracks per analysis batch                                                   |
| `AUDIO_BRPOP_TIMEOUT`              | `30`                               | Redis blocking wait timeout in seconds (also controls DB reconciliation)     |
| `AUDIO_MODEL_IDLE_TIMEOUT`         | `300`                              | Seconds before unloading idle ML models to free memory (0 = never unload)    |
| `LOG_LEVEL`                         | `warn` (prod) / `debug` (dev)      | Logging verbosity: debug, info, warn, error, silent                         |
| `DOCS_PUBLIC`                       | `false`                            | Set to `true` to allow public access to API docs in production              |

The music library path is configured via Docker volume mount (`-v /path/to/music:/music`).

#### External Access

If you're accessing Kima from outside your local network (via reverse proxy, for example), set the API URL:

```env
NEXT_PUBLIC_API_URL=https://kima-api.yourdomain.com
```

And add your domain to the allowed origins:

```env
ALLOWED_ORIGINS=http://localhost:3030,https://kima.yourdomain.com
```

---

## Security Considerations

### Environment Variables

Kima uses several sensitive environment variables. Never commit your `.env` file.

| Variable                  | Purpose                        | Required          |
| ------------------------- | ------------------------------ | ----------------- |
| `SESSION_SECRET`          | Session encryption (32+ chars) | Yes               |
| `SETTINGS_ENCRYPTION_KEY` | Encrypts stored credentials    | Yes               |
| `SOULSEEK_USERNAME`       | Soulseek login                 | If using Soulseek |
| `SOULSEEK_PASSWORD`       | Soulseek password              | If using Soulseek |
| `LIDARR_API_KEY`          | Lidarr integration             | If using Lidarr   |
| `OPENAI_API_KEY`          | AI features                    | Optional          |
| `LASTFM_API_KEY`          | Artist recommendations         | Optional          |
| `FANART_API_KEY`          | Artist images                  | Optional          |

### Authentication & Session Security

-   **JWT tokens** - Access tokens expire after 24 hours; refresh tokens after 30 days
-   **Token refresh** - Automatic token refresh via `/api/auth/refresh` endpoint
-   **Password changes** - Changing your password invalidates all existing sessions
-   **Session cookies** - Secured with `httpOnly`, `sameSite=strict`, and `secure` (in production)
-   **Encryption validation** - Encryption key is validated on startup to prevent insecure defaults

### Webhook Security

-   **Lidarr webhooks** - Support signature verification with configurable secret
-   Configure the webhook secret in Settings → Lidarr for additional security

### Admin Dashboard Security

-   **Bull Board** - Job queue dashboard at `/admin/queues` requires authenticated admin user
-   **API Documentation** - Swagger docs at `/api-docs` require authentication in production (unless `DOCS_PUBLIC=true`)

### VPN Configuration (Optional)

If using Mullvad VPN for Soulseek:

-   Place WireGuard config in `backend/mullvad/` (gitignored)
-   Never commit VPN credentials or private keys
-   The `*.conf` and `key.txt` patterns are already in .gitignore

### Generating Secrets

```bash
# Generate a secure session secret
openssl rand -base64 32

# Generate encryption key
openssl rand -base64 32
```

### Network Security

-   Kima is designed for self-hosted LAN use
-   For external access, use a reverse proxy with HTTPS
-   Configure `ALLOWED_ORIGINS` for your domain

---

## CLAP Audio Analysis

The CLAP (Contrastive Language-Audio Pretraining) service generates audio similarity embeddings as part of the enrichment pipeline. The embeddings power audio-based signals such as mood bucket assignment (used by the Mood Mixer).

### Requirements

-   PostgreSQL with pgvector extension (included in `pgvector/pgvector:pg16` image)
-   2-4GB RAM per worker
-   CLAP model downloads automatically on first build (~700MB)

### Configuration

Environment variables in docker-compose.yml:

| Variable                  | Default | Description                                |
| ------------------------- | ------- | ------------------------------------------ |
| `CLAP_WORKERS`            | `2`     | Number of analysis workers (1-8)           |
| `CLAP_THREADS_PER_WORKER` | `1`     | CPU threads per worker (1-4)               |
| `CLAP_SLEEP_INTERVAL`     | `5`     | Queue poll interval in seconds             |

### Usage

The CLAP analyzer runs automatically alongside the main audio analyzer. Embeddings are generated during the enrichment pipeline and power audio-based signals such as mood bucket assignment.

---

## GPU Acceleration

GPU acceleration speeds up audio analysis (mood detection, BPM extraction, similarity embeddings). It is **optional** -- everything works on CPU, just slower.

### Requirements

-   NVIDIA GPU with CUDA support
-   NVIDIA drivers installed on the host (`nvidia-smi` should work)
-   [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) -- bridges Docker to your GPU

### Install NVIDIA Container Toolkit

The toolkit is required for any Docker container to access the GPU. Install it once:

**Fedora / Nobara / RHEL:**
```bash
curl -s -L https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo | sudo tee /etc/yum.repos.d/nvidia-container-toolkit.repo && sudo dnf install -y nvidia-container-toolkit && sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker
```

**Ubuntu / Debian:**
```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg && curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list && sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit && sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker
```

### Verify Host Setup

```bash
# Check NVIDIA driver
nvidia-smi

# Check container toolkit
nvidia-container-runtime --version
```

### Enable GPU

**All-in-One container:**
```bash
docker run -d --gpus all -p 3030:3030 -v /path/to/music:/music -v kima_data:/data chevron7locked/kima:latest
```

**Docker Compose:**

Uncomment the `devices` block under `audio-analyzer` (and optionally `audio-analyzer-clap`) in `docker-compose.yml`:

```yaml
reservations:
    memory: 2G
    devices:
        - driver: nvidia
          count: 1
          capabilities: [gpu]
```

Then restart: `docker compose up -d`

### Verify GPU Detection

```bash
# MusiCNN analyzer
docker logs kima_audio_analyzer 2>&1 | grep -i gpu

# CLAP analyzer
docker logs kima_audio_analyzer_clap 2>&1 | grep -i gpu
```

Expected: `TensorFlow GPU detected: ...` or `CUDA available: True`

If you see `TensorFlow running on CPU`, GPU passthrough is not active.

---

## Integrations

Kima works beautifully on its own, but it becomes even more powerful when connected to other services.

### Lidarr

Connect Kima to your Lidarr instance to request and download new music directly from the app.

**What you get:**

-   Browse artists and albums you don't own
-                 Request downloads with a single click
-   Discover Weekly playlists that automatically download new recommendations
-   Automatic library sync when Lidarr finishes importing

**Setup:**

1. Go to Settings in Kima
2. Navigate to the Lidarr section
3. Enter your Lidarr URL (e.g., `http://localhost:8686`)
4. Enter your Lidarr API key (found in Lidarr under Settings > General)
5. Test the connection and save

Kima will automatically configure a webhook in Lidarr to receive notifications when new music is imported.

**Networking Note:**

The webhook requires Lidarr to be able to reach Kima. By default, Kima uses `host.docker.internal:3030` which works automatically when using the provided docker-compose files (they include `extra_hosts` to enable this on Linux).

If you're using **custom Docker networks** with static IPs, set the callback URL so Lidarr knows how to reach Kima:

```yaml
environment:
    - KIMA_CALLBACK_URL=http://YOUR_KIMA_IP:3030
```

Use the IP address that Lidarr can reach. If both containers are on the same Docker network, use Kima's container IP.

### Soulseek

Kima includes built-in Soulseek support for finding rare tracks and one-offs that aren't available through traditional download sources like Lidarr.

[Soulseek](https://www.slsknet.org/) is a peer-to-peer file sharing network focused on music. Users share their music libraries and can browse/download from each other. Kima connects directly to the Soulseek network -- no additional software (like slskd) is required.

**Setup:**

1. Go to Settings in Kima
2. Navigate to the Soulseek section
3. Enter your Soulseek username and password (create an account at [slsknet.org](https://www.slsknet.org/) if you don't have one)
4. Save your settings

**How Search Works:**

When you search for music in Kima's Discovery tab, Soulseek results appear alongside Last.fm and Deezer results. Each result shows the filename, file size, bitrate, and format (FLAC/MP3). Metadata like artist and album is parsed from the file path structure (typically `Artist/Album/01 - Track.flac`).

**How Download Works:**

1. Click the download button on a Soulseek search result
2. Kima searches the Soulseek network for the best match (preferring FLAC, high bitrate)
3. The file is downloaded directly to your music library path
4. A library scan is triggered to import the new file
5. Metadata enrichment runs automatically (artist info, mood tags, audio analysis)

You can also configure Soulseek as a download source for playlist imports. In Settings > Downloads, set Soulseek as primary or fallback source. When importing a Spotify/Deezer playlist, tracks not found in your library will be searched and downloaded from Soulseek automatically.

**Download progress** is visible in the Activity Panel (bell icon in the top bar).

**Limitations:**

- Download speed depends on the sharing user's connection and availability
- Not all tracks will have results -- Soulseek coverage varies by genre and popularity
- Some users may have slow connections or go offline during transfers
- Kima retries with alternative users if a download fails or times out

### API Tokens

The OpenSubsonic API was removed from this fork (audio playback was removed entirely — see `docs/skip-features.md`). You can still generate API tokens under **Settings > Native Apps** for programmatic access to the Kima REST API; each token is named, can be revoked individually, and is used as a `Bearer` credential.

---

## Using Kima

### First-Time Setup

When you first access Kima, you'll be guided through a setup wizard:

1. **Create your account** - The first user becomes the administrator
2. **Configure integrations** - Optionally connect Lidarr, Soulseek, and other services
3. **Wait for library scan** - Kima will scan and catalog your music collection

### The Home Screen

After setup, your home screen displays:

-   **Recently Added** - New additions to your library
-   **Made For You** - Auto-generated mixes based on your library (with the Mood Mixer button)
-   **Recommended** - Artist recommendations from Last.fm
-   **Popular Artists** - Trending artists on Last.fm
-   **Featured Playlists** - Curated Deezer playlists

### Searching

Kima offers two search modes:

**Library Search** - Find artists, albums, and tracks in your collection. Results are instant and searchable by name.

**Discovery Search** - Find new music you don't own. Powered by Last.fm. From discovery results, you can:

-   Preview tracks via Deezer
-   Request downloads through Lidarr

<p align="center">
  <img src="assets/screenshots/desktop-artist.png" alt="Artist Page" width="800">
</p>
<p align="center">
  <img src="assets/screenshots/desktop-album.png" alt="Album Page" width="800">
</p>

### Creating Playlists

1. Navigate to your Library and select the Playlists tab
2. Click "New Playlist" and give it a name
3. Add tracks by clicking the menu on any song and selecting "Add to Playlist"
4. Reorder tracks by dragging and dropping
5. Toggle "Public" to share with other users on your instance

### Mood Mixer

1. On the home screen, click **Mood Mixer** next to the Made For You section
2. Select a mood preset -- Kima instantly generates a playlist from your library calibrated to that mood
3. Each preset count shows how many tracks in your library match that mood
4. Generated mixes are saved automatically, so you can open and manage them like any other playlist

### Importing Playlists

**From Spotify:**

1. Copy a Spotify playlist URL
2. Go to Import (in the sidebar)
3. Paste the URL and click Preview
4. Review the results - you'll see which tracks are in your library, which can be downloaded, and which aren't available
5. Select albums to download and start the import

**From Deezer:**

1. Browse featured playlists directly in the Browse section, or paste a Deezer playlist URL
2. The same preview and import flow applies
3. Explore Deezer's curated playlists and radio stations for discovery

**From YouTube:**

1. Copy a YouTube or YouTube Music playlist URL
2. Paste it in the import field on the Playlists page
3. Kima extracts individual tracks and resolves them via song.link to identify each one
4. The same preview and import flow applies

### Settings

In Settings you can configure integrations (Lidarr, Soulseek), download behavior, library enrichment/cache options, user management, and API tokens.

**Navidrome Sync** - Mirror Kima playlists to your Navidrome instance so they play in any Subsonic-compatible client. Sync runs after imports, scans, and manual playlist edits (within a minute of changes). The admin configures the **global target** (synced for every user's playlists). Each user can optionally add a **personal target** (their own Navidrome account) under Settings → "Navidrome Sync (persönlich)".

<p align="center">
  <img src="assets/screenshots/desktop-settings.png" alt="Settings" width="800">
</p>

### Android TV

Kima includes a dedicated interface optimized for television displays:

-   Large artwork and readable text from across the room
-   Full D-pad and remote navigation support
-   Simplified navigation focused on browsing and curation

The TV interface is automatically enabled when accessing Kima from an Android TV device. Access it through your TV's web browser.

---

## Administration

### Managing Users

As an administrator, you can:

1. Go to Settings > User Management
2. Create new user accounts
3. Delete existing users (except yourself)
4. Users can be assigned "admin" or "user" roles

### System Settings

Administrators have access to additional settings:

-   **Lidarr/Soulseek** - Configure integrations
-   **Storage Paths** - View configured paths
-   **Cache Management** - Clear caches if needed
-   **Advanced** - Download retry settings, concurrent download limits

### Download Settings

Configure how Kima acquires new music in Settings → Downloads:

-   **Primary Source** - Choose between Soulseek or Lidarr as your main download source
-   **Fallback Behavior** - Optionally fall back to the other source if the primary fails
-   **Stale Job Cleanup** - Clear stuck Discovery batches and downloads that aren't progressing

### Enrichment Settings

Control metadata enrichment in Settings → Cache & Automation:

-   **Enrichment Speed** - Adjust concurrency (1-5x) to balance speed vs. system load
-   **Failure Notifications** - Get notified when enrichment fails for specific items
-   **Retry/Skip Modal** - Choose to retry failed items or skip them to continue processing

### Activity Panel

The Activity Panel provides real-time visibility into downloads and system events:

-   **Notifications** - Alerts for completed downloads, ready playlists, and import completions
-   **Active Downloads** - Monitor download progress in real-time
-   **History** - View completed downloads and past events

Access the Activity Panel by clicking the bell icon in the top bar (desktop) or through the menu (mobile).

### API Keys

For programmatic access to Kima:

1. Go to Settings > API Keys
2. Generate a new key with a descriptive name
3. Use the key in the `Authorization` header: `Bearer YOUR_API_KEY`

API documentation is available at `/api-docs` when the backend is running (requires authentication in production).

### Bull Board Dashboard

Monitor background job queues at `/admin/queues`:

-   View active, waiting, completed, and failed jobs
-   Retry or remove stuck jobs
-   Monitor download progress and enrichment tasks
-   Requires admin authentication

---

## Architecture

Kima consists of several components working together:

```
                                    ┌─────────────────┐
                                    │   Your Browser  │
                                    └────────┬────────┘
                                             │
                                             ▼
┌─────────────────┐              ┌─────────────────────┐
│  Music Library  │◄────────────►│     Frontend        │
│   (Your Files)  │              │   (Next.js :3030)   │
└─────────────────┘              └──────────┬──────────┘
                                            │
                                            ▼
┌─────────────────┐              ┌─────────────────────┐
│    Lidarr       │◄────────────►│      Backend        │
│   (Optional)    │              │  (Express.js :3006) │
└─────────────────┘              └──────────┬──────────┘
                                             │
                                             ▼
                                  ┌─────────────────────┐
                                  │  ┌───────────────┐  │
                                  │  │  PostgreSQL   │  │
                                  │  └───────────────┘  │
                                  │  ┌───────────────┐  │
                                  │  │     Redis     │  │
                                  │  └───────────────┘  │
                                  └─────────────────────┘
```

| Component           | Purpose                                    | Default Port |
| ------------------- | ------------------------------------------ | ------------ |
| Frontend            | Web interface (Next.js)                    | 3030         |
| Backend             | API server (Express.js)                    | 3006         |
| PostgreSQL          | Database (with pgvector)                   | 5432         |
| Redis               | Caching and job queues                     | 6379         |
| Audio Analyzer      | Mood, BPM, key detection (Essentia MusiCNN)| --           |
| Audio Analyzer CLAP | Audio similarity embeddings (LAION CLAP)   | --           |

---

## Roadmap

Kima is under active development. Here's what's planned:

-   **Native Mobile App** - React Native application for iOS and Android
-   **Offline Mode** - Download tracks/albums for offline use in your player
-   **Windows Executable** - Standalone app for Windows users who prefer not to use Docker

Contributions and suggestions are welcome.

---

## License

Kima is released under the [GNU General Public License v3.0](LICENSE).

You are free to use, modify, and distribute this software under the terms of the GPL-3.0 license.

---

## Acknowledgments

Kima wouldn't be possible without these services and projects:

-   [Last.fm](https://www.last.fm/) - Artist recommendations and music metadata
-   [MusicBrainz](https://musicbrainz.org/) - Comprehensive music database
-   [Deezer](https://developers.deezer.com/) - Track previews and playlist browsing
-   [Odesli/song.link](https://odesli.co/) - Cross-platform music link resolution
-   [Fanart.tv](https://fanart.tv/) - Artist images and artwork
-   [Lidarr](https://lidarr.audio/) - Music collection management

---

## Support

If you encounter issues or have questions:

1. Check the [Issues](https://github.com/Chevron7Locked/kima-hub/issues) page for known problems
2. Open a new issue with details about your setup and the problem you're experiencing
3. Include logs from `docker compose logs` if relevant

---

_Built with love for the self-hosted community._
