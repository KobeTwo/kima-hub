# Design Spec: Remove All Playback / Play Features

**Date:** 2026-07-09
**Author:** opencode
**Status:** Approved

## Overview

Remove all audio playback functionality from kima-hub (frontend and backend). Kima becomes a
library / metadata / download tool with playlist sync to Navidrome; **Navidrome is the player**
for all audio (music, audiobooks, podcasts).

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Subsonic/OpenSubsonic API (`/rest/...`) | Removed completely (streaming, scrobble, now-playing, play-queue, bookmarks, device linking) |
| Share feature | Kept, but without audio: share page shows track list only, no player, no stream endpoint |
| Audiobooks / Podcasts | Features removed completely (routes, models, UI pages, Audiobookshelf integration) |
| Play tracking (`Play` model, `/api/plays`, `playCount` badges, top-songs ranking) | Removed completely |
| Lyrics panel, Radio page, Queue page, Offline albums | Removed |
| **Deezer previews** | **Kept** (explicit user decision) — artist previews, discover previews, pending-playlist previews |
| Mixes & Discovery | Kept as curation features; play-history input is removed, they fall back to metadata-only signals (genre, artist, library recency) |
| Removal strategy | Direct, bundled by area (no feature flag). Rollback via git. |

## Frontend — What to Remove

### Audio core (`frontend/lib/`) — delete entirely
- `audio-engine-policy.ts`
- `audio-controller.ts`
- `audio-state-context.tsx`
- `audio-playback-context.tsx`
- `audio-controls-context.tsx`
- `audio-controller-context.tsx`
- `audio-context.tsx`
- `audio-hooks.tsx`
- `book-session.ts`
- `iosAudioLog.ts`
- `__tests__/audio-engine-policy.test.ts`, `__tests__/book-session.test.ts`

### Providers
- `components/providers/ConditionalAudioProvider.tsx`
- `components/providers/AudioErrorBoundary.tsx`
- Remove provider mounting from `app/layout.tsx`

### Player UI — delete entirely
- `components/player/*` (UniversalPlayer, FullPlayer, MiniPlayer, OverlayPlayer, SeekSlider, SleepTimer, KeyboardShortcutsTooltip, PlayerModeWrapper, MediaControlsHandler)
- `components/lyrics/*` (LyricsPanel, MobileLyricsView)
- `components/ui/PlayableCard.tsx`
- `components/layout/UnifiedPanel.tsx` (vibe/activity panel with now-playing tab; mounted in `AuthenticatedLayout`)
- TV "Now Playing Bar" in `components/layout/TVLayout.tsx`

### Playback hooks — delete entirely
- `useMediaSession.ts`, `useKeyboardShortcuts.ts`, `usePlayerMode.ts`, `usePlaybackProgress.ts`,
  `useMediaInfo.ts`, `useSleepTimer.ts`, `useDoubleTap.ts`, `useLyricsSync.ts`, `useLyricsToggle.ts`

### Features / call sites
- Play actions removed from all action hooks: `useAlbumActions`, `useArtistActions`,
  `useLibraryActions`, `useDiscoverActions` (play parts only — keep discovery itself)
- Play buttons / row-click-to-play / `playCount` badges removed from: `TrackList` (album),
  `AlbumActionBar`, `ArtistActionBar`, `PopularTracks`, `Discography`, `TracksList` (library),
  `AlbumsGrid`, `ArtistsGrid`, `UnifiedSongsList`, `LibraryTracksList`, playlist & mix & collection pages
- Vibe feature removed entirely: `features/vibe/*` (VibeMap, VibeAlchemy, ActivityIconBar,
  panel-shared, tabs, scenes, types)
- Deezer preview hooks **kept**, but the main-player pause calls (`controller.pause()`,
  `controller?.pause()`) are removed so previews run standalone:
  - `hooks/useTrackPreview.ts`
  - `features/discover/hooks/usePreviewPlayer.ts`

### Pages — delete entirely
- `app/radio/` (library shuffle played through the main player)
- `app/queue/` (queue management)
- `app/audiobooks/` (whole feature)
- `app/podcasts/` (whole feature)
- `app/device/` (Subsonic device-linking page)
- `app/debug/ios-log/` (iOS audio diagnostics)

### Share page (`app/share/[token]/SharePageClient.tsx`)
- Remove `<audio>` element, player controls (play/pause/next/prev/seek/volume/mute),
  stream-URL helpers, playback error state
- Keep: share metadata, track/album/playlist listing, cover art

### Settings
- Remove `features/settings/components/sections/PlaybackSection.tsx` (stream quality) and its mount

### Navigation
- Remove nav / bottom-nav / TV entries for Radio, Queue, Audiobooks, Podcasts, Vibe (wherever they are linked)

### API client (`lib/api.ts`)
- Remove: stream URLs, `getPlaybackState`/`savePlaybackState`, `prewarmTrack`, plays,
  playback-state, listening-state, audiobook/podcast stream + progress, share stream,
  offline album download, subsonic device-link, iOS-log flush, lyrics fetching
- Keep: Deezer preview stream URLs (artist preview, pending playlist preview)

## Frontend — What to Keep
- Library browsing (albums, artists, tracks), search, discover (without play buttons,
  previews remain), releases, collections
- Playlists & mixes as data (play buttons removed); Navidrome playlist sync (settings + sync pages)
- Download pipeline UI (Lidarr/import)
- Share pages (list-only)
- Settings (without playback section), auth, onboarding, admin

## Backend — What to Remove

### Routes — delete entirely
- `routes/library/streaming.ts` (track stream + prewarm)
- `routes/subsonic/` (entire directory — all `/rest/*`)
- `routes/plays.ts`
- `routes/playbackState.ts`
- `routes/listeningState.ts`
- `routes/audiobooks.ts` (entire feature)
- `routes/podcasts.ts` (entire feature)
- `routes/offline.ts` (offline album cache)

### Routes — modify
- `routes/share.ts`: remove `GET /api/share/:token/stream/:trackId` and all `maxPlays`/`playCount`
  enforcement; keep share CRUD + cover art
- `routes/artists.ts`: keep `GET /api/artists/preview/:artistName/:trackTitle/stream`
  (Deezer preview — kept per user decision), remove nothing else from this file
- `routes/playlists.ts`: keep `GET /api/playlists/:id/pending/:trackId/preview/stream`
  (pending-track preview — kept); remove no other routes from this file

### Services — delete (verified: no remaining references after route removal)
- `services/audioStreaming.ts` (FFmpeg transcode + range streaming) + its Jest test
- `services/audiobookshelf.ts`

### `index.ts` / `config.ts`
- Unmount all removed routes; remove the special no-rate-limit case for playback-state
- Remove transcode-cache config (`TRANSCODE_CACHE_PATH`, `transcodeCacheMaxGb`) and
  audio-stream socket timeout settings

## Backend — What to Keep
- Library/album/artist/track/genre routes, search, discover, playlists, collections, releases
- Download pipeline (`downloads.ts`, Lidarr, import), enrichment, Navidrome sync, auth,
  sharing (without stream), settings (without `playbackQuality`), system/webhook routes

## Indirect Dependencies (modify, not delete)

### Backend
- `src/routes/discover.ts` — drop retroactive `DISCOVERY_KEPT` play-marking (lines ~738, ~808)
- `src/routes/library/tracks.ts` — drop audiobook/podcast progress blocks ("continue listening")
- `src/routes/recommendations.ts` — drop play-count aggregation; use metadata fallback
- `src/routes/library/artists.ts` — drop `prisma.play.groupBy` recent-artist logic (line ~522);
  the Last.fm `playcount` in `routes/artists.ts` is external metadata and stays
- `src/routes/settings.ts` — remove `playbackQuality`
- `src/routes/systemSettings.ts` + `src/utils/systemSettings.ts` — remove `audiobookshelf*` fields
- `src/routes/onboarding.ts` — remove `/onboarding/audiobookshelf` endpoint, `offlineEnabled` defaults
- `src/routes/auth.ts` — review/trim Subsonic device-link & token-auth remnants (`offlineEnabled` default)
- `src/services/discoverWeekly.ts` — replace "popular tracks by plays" / "recent plays" with metadata signals
- `src/services/discovery/discoverySeeding.ts` — drop play-history seeding, fall back to metadata (or no-op seeding)
- `src/services/mixes/discoveryMixes.ts`, `src/services/mixes/moodMixes.ts` — drop `_count.plays` filters,
  use metadata-only selection (genre/artist/availability)
- `src/services/featureDetection.ts` — remove `audiobookshelfEnabled` check
- `src/index.ts` — unmount removed routes, remove Subsonic middleware wiring, drop
  playback-state rate-limit exemption
- Delete: `src/middleware/subsonicAuth.ts`, `src/utils/subsonicResponse.ts`,
  `src/services/audiobookCache.ts`
- Jest: delete `routes/__tests__/audiobooks.route.test.ts`,
  `routes/library/__tests__/streaming.route.test.ts`, `services/__tests__/audiobookshelf.test.ts`,
  `services/__tests__/audioStreaming.test.ts`; fix `routes/__tests__/share.route.test.ts`
  (no more stream/maxPlays/playCount assertions)

### Frontend
- `components/layout/Sidebar.tsx` — drop Radio/Audiobooks/Podcasts nav entries
- `features/settings/` — delete `AudiobookshelfSection.tsx` + `PlaybackSection.tsx`;
  trim `types.ts`, `hooks/useSystemSettings.ts`, `hooks/useSettingsData.ts`, `app/settings/page.tsx`
- `features/settings/components/sections/CacheSection.tsx` — remove offline-content storage setting
- `app/onboarding/page.tsx` — remove Audiobookshelf config step
- `lib/features-context.tsx` — remove `audiobookshelfEnabled`
- `app/audiobooks/`, `app/podcasts/` directories deleted with the features

## Data Model — One Destructive Prisma Migration

### Models to drop
`Play` (+ `ListenSource` enum), `PlaybackState`, `ListeningState`, `Audiobook`,
`AudiobookProgress`, `Podcast`, `PodcastEpisode`, `PodcastDownload`, `PodcastProgress`,
`PodcastSubscription`, `PodcastRecommendation`, `SubsonicBookmark`, `SubsonicPlayQueue`,
`DeviceLinkCode`, `TranscodedFile` (only referenced by `audioStreaming.ts` + its test),
`CachedTrack` (only referenced by `routes/offline.ts`)

### Models to keep
- `UserMoodMix` — used by mixes (`routes/mixes.ts`, home page); unrelated to playback

### Fields / relations to drop
- `ShareLink.maxPlays`, `ShareLink.playCount`
- `UserSettings.playbackQuality`, `UserSettings.offlineEnabled`
- `Track.plays`, `User.plays` relations
- All `User` relations to dropped models (`audiobookProgress`, `cachedTracks`,
  `deviceLinkCodes`, `listeningState`, `playbackState`, `podcastDownloads`,
  `podcastProgress`, `podcastSubscriptions`, `subsonicBookmarks`, `subsonicPlayQueue`)

### Data loss (accepted)
Play history, audiobook/podcast progress, Subsonic queues/bookmarks, device-link codes,
transcode-cache entries, offline caches are lost. No other tables affected.

Migration is applied via `migrate-safe.sh` on backend start (existing deploy behavior).

## Error Handling
- Removed endpoints return 404 (expected for old clients)
- Orphaned localStorage keys (`kima_queue`, `kima_current_track`, `kima_volume`,
  `kima_ios_audio_log`, ...) are harmless; optional small cleanup: delete them at app init
- All internal links to removed pages are removed from nav; direct URLs 404 via Next default
- No feature flag — code is gone, so no dead code paths remain

## Testing

### Remove
- Vitest: `audio-engine-policy.test.ts`, `book-session.test.ts` (files deleted with lib)
- Playwright: `playback.spec.ts`, `queue.spec.ts`

### Adapt
- `smoke.spec.ts`: drop login→play-album flow, keep app-load assertions
- `full-ux-audit.spec.ts`: remove playback tests, drop `/radio` from page inventory
- `test-helpers.ts`: remove audio helpers (`startPlayingFirstAlbum`, `getAudioSrc`, ...)
- Backend Jest: remove tests/mocks referencing removed routes/services (`__mocks__` check)

### Keep
- All library/search/playlist/discover e2e specs (adapt selectors where play buttons disappear)

## Verification Gates (per commit area)
- Frontend: `tsc`/build + ESLint + Vitest after areas 1–3
- Backend: `tsc`/build + Jest after area 4
- Prisma: `prisma validate` + migration review before area 5 lands
- Full Playwright suite at the end; then deploy to minipc and verify in browser

## Implementation Order (commits)
1. Frontend: audio core, providers, player UI, playback hooks, vitest config/test cleanup
2. Frontend: call sites, pages, vibe, share page, settings, navigation, `api.ts`
3. Frontend: preview hooks standalone (drop main-player coupling)
4. Backend: routes, services, `index.ts`, `config.ts`
5. Prisma schema + destructive migration
6. Tests trimmed + docs (AGENTS.md/README mentions of playback)
7. Full build + e2e, deploy, verify
