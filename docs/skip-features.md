# Removed Features

The following features have been removed from this fork. Do not re-add them.

## Vibe System (Audio Embeddings)

- **CLAP audio analysis service** — Docker service running LAION CLAP model for audio embedding generation
- **Vibe embeddings in PostgreSQL** — `vibeEmbedding` column (vector type, 512 dimensions) and related columns on tracks
- **pgvector extension** — vector similarity search for vibe matching
- **Vibe vocabulary** — text-to-embedding mapping via ML model
- **Vibe map/Galaxy view UI** — deck.gl 2D/3D visualization of audio embedding space (`VibeSection`, `VibeMap`, `VibeGalaxy`)
- **Drift feature** — path-finding between two tracks in embedding space
- **Blend feature** — centroid-based queue generation from multiple tracks
- **Mood Mixer** — preset-based queue generation from audio analysis
- **"Keep The Vibe Going"** — continuous similar-track queueing from player
- **Vibe from track context menu** — similar-track queueing from any track
- **Find Similar on map** — highlighting similar tracks on the visualization
- **Vibe search endpoint** (`POST /api/vibe/search`) — text-to-tracks via embedding search
- **Vibe similar endpoint** (`GET /api/vibe/similar/:id`) — tracks similar to given track
- **Vibe status endpoint** (`GET /api/vibe/status`) — embedding progress

## Audio Analysis Service

- **Audio analyzer service** — Docker container with Essentia/MusiCNN for mood, BPM, and key detection
- **Audio enrichment pipeline** — MusiCNN mood classification, BPM extraction, key detection
- **Audio analysis worker queue** — BullMQ job queue for processing tracks
- **Audio analysis environment variables** — `AUDIO_ANALYSIS_WORKERS`, `AUDIO_ANALYSIS_THREADS_PER_WORKER`, `AUDIO_ANALYSIS_BATCH_SIZE`, `AUDIO_BRPOP_TIMEOUT`, `AUDIO_MODEL_IDLE_TIMEOUT`
- **CachedAnalysis table** — storing mood, BPM, key analysis results

## AI Features

- **OpenAI API key** — any integration with OpenAI or similar LLM providers
- **LLM-based recommendations** — content generation via language models
- **Vibe vocabulary generation** — ML-based text vocabulary from embeddings

## Why These Were Removed

- **pgvector and embeddings** — requires significant RAM for the extension, complex setup, and the ML models are large downloads
- **Audio analyzer** — 2-4GB RAM per worker, plus ML model downloads (~700MB CLAP + ~1GB TensorFlow models)
- **AI features** — removed as personal preference (no LLM integration needed)
- The platform works fully without any of these features. Music discovery still works via Last.fm recommendations, genre/era mixes, and playlist features.

## Current Discovery Features

- Last.fm artist recommendations
- Genre-based radio stations
- Era/decade mixes (Your 90s, Your 2000s, etc.)
- Lidarr integration for new music
- Playlist import from Spotify/Deezer/YouTube
- Manual playlist curation