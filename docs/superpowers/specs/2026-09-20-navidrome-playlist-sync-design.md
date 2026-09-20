# Kima → Navidrome Playlist-Sync — Design

**Datum:** 2026-09-20
**Status:** Freigegeben (User-Review 2026-09-20)

## Ziel

Kima-Playlists (Spotify-Importe + manuell angelegte) sollen nach jeder Änderung automatisch in Navidrome gespiegelt werden, damit die Playlists dort (in beliebigen Subsonic-Clients) abgespielt werden können — Kima-Playback ist unzuverlässig.

## Kontext

- **Kima:** Self-hosted Music Server (Express + Prisma/Postgres + BullMQ/Redis), vollständige Subsonic-API unter `/rest` (Port 4534). Playlisten-Modell: `Playlist` (Owner `userId`, `mixId`, `isPublic`), `PlaylistItem` (Track + `sort`), `PlaylistPendingTrack` (noch nicht auf Platte). `Track` hat `isrc`, `duration`, `title`; Album-Name ist `Album.title`, Artist ist `Artist.displayName || Artist.name`.
- **Navidrome:** Subsonic-Server (Port 4533, `navidrome.kt.run.place`), aktuell v0.6x (`deluan/navidrome:latest`).
- **Gemeinsame Library:** Beide zeigen auf denselben Musikordner der minipc → Titel/Artist sind fast immer identisch.
- **Bewährtes Matching-Pattern:** `usenet/spotify_importer` (Python) importiert Spotify-Playlists per Subsonic `search3` + Scoring (Titel/Artist/Album) nach Navidrome.
- **Navidrome-ISRC:** Die Subsonic-Song-Response enthält `isrc` (OpenSubsonic-Extension, aus Dateitags; `server/subsonic/responses/responses.go`, `OpenSubsonicChild.Isrc`). Die FTS5-Suchindizes (v0.6x) indexieren **keine** ISRC → Suche *nach* ISRC-String ist nicht möglich; ISRC ist nur ein Attribut der Such-Candidates.
- **Kima-Settings:** `SystemSettings` (einzelne DB-Zeile `id="default"`), Secrets AES-verschlüsselt (analog `soulseekPassword`), 60s-Cache, per Web-UI verwaltebar (Sections in `frontend/features/settings/components/sections/`).

## Entscheidungen (Brainstorming-Ergebnis)

| # | Entscheidung |
|---|--------------|
| 1 | Scope: Alle eigenen Kima-Playlisten mit `mixId = null` (Vibe-/Mix-Playlisten raus); nur echte Tracks (keine Pending-Tracks) |
| 2 | Trigger: Event-basiert aus Kima (nach Import/Reconcile/CRUD) + Debounce; manueller Trigger via „Sync now"-Button in den Einstellungen |
| 3 | Architektur: Komplett im Kima-Fork (neuer Backend-Service + Settings-UI-Section), kein zweiter Service, kein Webhook-Target |
| 4 | Matching: ISRC-first (entscheidend innerhalb der Such-Candidates), Fallback: bewährtes Titel/Artist/Album-Scoring + Dauer-Tie-Breaker |
| 5 | Config: In Kimas SystemSettings (Web-UI), **nicht** in `.env` |
| 6 | Single-User: 1 Kima-User + 1 Navidrome-Account; keine Multi-User-/Per-User-Logik |

## Komponenten

### 1. SystemSettings-Erweiterung (Backend)

Prisma-Migration für `SystemSettings` (Zeile `id = "default"`), neue Felder:

- `navidromeSyncEnabled Boolean @default(false)`
- `navidromeUrl String?`
- `navidromeUser String?`
- `navidromePassword String?` (verschlüsselt, analog `soulseekPassword`)
- `navidromeNamePrefix String @default("")`

- `utils/systemSettings.ts`: `navidromePassword` in die `safeDecrypt`-Liste.
- `routes/systemSettings.ts`: GET (Password dechiffriert) und POST (zod-Validierung + verschlüsseln) erweitern.

### 2. NavidromeSync-Service (`backend/src/services/navidromeSync.ts`)

- Settings lesen über `getSystemSettings()` (60s-Cache vorhanden). Aktiv nur wenn `navidromeSyncEnabled && url && user && password`.
- **Matching-Hilfen** in separater Datei `backend/src/services/navidromeMatching.ts` (reine Funktionen, unit-testbar):
  - Normalisierung: lowercase, `(…)`/`[…]` entfernen, `feat. …`-Suffixe, gängige Album-Suffixe (remaster/deluxe/…), Whitespace (Port aus `spotify_importer`)
  - Queries in Reihenfolge (stopp beim ersten Treffer): `"<title> <artist>"`, `"<title> <erster Artist>"`, `"<title>"`
  - Scoring pro Candidate: Titel exakt (normalisiert) +100 / Teiltreffer +60; Artist normalisierte Teilmenge +50; Album exakt +10; Schwelle ≥ 70
  - **ISRC (entscheidend):** Hat der Kima-Track eine ISRC und enthält das `isrc`-Array eines Such-Candidates diese ISRC → dieser Candidate gewinnt, unabhängig vom Fuzzy-Score. Nur innerhalb der Candidate-Liste (Navidrome kann nicht nach ISRC suchen).
  - **Dauer-Tie-Breaker:** Bei Punkte-Gleichstand: Kandidat mit `|Δduration| ≤ 3 s` bevorzugen.
- **Debounce/Flush:**
  - `markDirty(playlistId)`: in-memory `Set`; nie throw (fire-and-forget)
  - Intervall-Poller: alle **60 s** flushen alle dirty Playlists (Lazy-Start beim ersten `markDirty`; `unref()`)
  - Flush-Guard gegen parallele Flushes; Restart verliert das dirty-Set (akzeptabel — nächster Event oder manueller Trigger)
- `syncPlaylist(playlistId)`:
  1. Playlist + Items (per `sort`) via Prisma; nur echte Tracks
  2. Leer → skip + Log; `mixId` gesetzt → skip
  3. Zielname = `navidromeNamePrefix + playlist.name`
  4. Tracks matchen → `songIds` in Kima-Reihenfolge (Search-Results pro Query pro Run cachen)
  5. **0 Matches → skip** (neue Status `skipped_no_matches`, Navidrome-Kopie bleibt unangetastet)
  6. Sonst: Navidrome `getPlaylists` → Eintrag mit exakt gleichem Namen finden → `deletePlaylist`
  7. `createPlaylist(name, songIds)` (repeated `songId`-Params)
  8. Log: `[NavidromeSync] Synced "<name>": 142/145 tracks` + `missing: …` (max. 20)
- `syncAll()`: alle Playlisten mit `mixId = null` (manueller Trigger)
- `testConnection(url, user, password)`: `getPlaylists`-Aufruf, ok/Fehler (für UI-Button)
- Subsonic-Calls: POST `{url}/rest/<method>.view`, form-encoded (`URLSearchParams`, wiederholte Keys), `v=1.16.1`, `c=kima-navidrome-sync`, `f=json`, `u`/`p`; Status != ok → Fehler

### 3. Events / Hook-Punkte

`navidromeSync.markDirty(playlistId)` — immer fire-and-forget (intern try/catch + Log, niemals im Request-Flow werfen):

| Hook | Exakter Ort |
|------|-------------|
| Spotify-Import: Playlist gebaut | `services/spotifyImport.ts`, `buildPlaylist()`, direkt nach `job.createdPlaylistId = playlist.id` |
| Reconcile: Pending → echte Tracks | `services/spotifyImport.ts`, `reconcilePendingTracks()`, für jede Playlist im `playlistsWithAdditions`-Set vor dem finalen `return` |
| REST-CRUD | `routes/playlists.ts`: `POST /` (create), `PUT /:id` (rename), `POST /:id/items`, `DELETE /:id/items/:trackId`, `PUT /:id/items/reorder` |
| Subsonic-Playlisten | `routes/subsonic/playlists.ts`: `createPlaylist` (nach `resolvedPlaylistId`), `updatePlaylist` (nur wenn Name oder Song-Liste sich ändert) |
| **Kein** Delete-Hook | Löschungen in Kima (REST `DELETE /:id`, Subsonic `deletePlaylist`) lösen **keinen** Sync aus — siehe Lösch-Semantik |

**Manueller Trigger:** Neue Endpoints an der SystemSettings-Route (Admin):

- `POST /api/system-settings/test-navidrome` `{url, username, password}` → `testConnection()` (Pattern: `/test-lidarr`)
- `POST /api/system-settings/navidrome-sync/now` `{playlistIds?}` → `syncAll()` bzw. nur diese Playlisten

### 4. Frontend: „Navidrome Sync"-Section

- Neue Section `frontend/features/settings/components/sections/NavidromeSyncSection.tsx` (Pattern: `LidarrSection`).
- Inhalt: Toggle (enabled), URL, User, Password (maskiert), Name-Prefix, **Test-Connection**-Button (via `onTest("navidrome")`), **Sync now**-Button (direkt `api.syncNavidromeNow()`, Ergebnis-Inline-Status).
- `frontend/app/settings/page.tsx`: Sidebar-Item + Section rendern (Admin-Block, nach `LidarrSection`).
- `frontend/features/settings/types.ts`: `SystemSettings`-Felder ergänzen; `useSystemSettings.ts`: Default-Werte + `testService`-Case `navidrome`; `frontend/lib/api.ts`: `testNavidrome()`, `syncNavidromeNow()`.

### 5. Fehlerbehandlung & Logs

- Alle Sync-Fehler: Kima-Logger mit `[NavidromeSync]`-Prefix; nie nach außen thrown.
- Navidrome down → Log; nächster 60s-Tick / manueller Trigger versucht es erneut (kein Retry-Loop).
- Gescheiterte Syncs werden vom nächsten 60s-Tick erneut versucht (max. ein Retry pro Tick, kein Retry-Loop).
- Fehlkonfiguration (enabled, aber unvollständig) → Log, Inaktiv.
- **Lösch-Semantik (bewusst unsymmetrisch):** Kima-Playlist löschen → Navidrome-Kopie bleibt stehen (keine automatischen Löschungen in Navidrome → kein Datenverlust bei Namens-Collisionen). Umbenennen in Kima erzeugt eine neue Navidrome-Playlist; die alte bleibt.

## Out of Scope (YAGNI)

- Multi-User / per-User Navidrome-Credentials
- Reverse-Sync (Navidrome → Kima)
- Auto-Download fehlender Tracks (dafür gibt es Kima-Pending/Retry)
- UI jenseits der Settings-Section
- Sync von Pending-Tracks
- Automatisches Löschen der Navidrome-Kopie bei Kima-Delete

## Tests

Jest, Kima-Konvention (`backend/src/services/__tests__/`), Prisma + axios + `getSystemSettings` gemockt:

- **navidromeMatching:** Normalisierung (Suffixes/feat./Klammern), Query-Generierung (3 Stufen + Dedupe), Scoring-Schwelle, ISRC-Exakt-Treffer gewinnt innerhalb der Candidates, Fallback wenn kein Candidate die ISRC hat, Dauer-Tie-Breaker
- **navidromeSync.syncPlaylist:** delete-then-create, Reihenfolge der `songIds` (repeated params), leere/mix-Playlisten skip, missing-Tracks werden ausgelassen + geloggt, Name-Prefix, inaktiv wenn nicht konfiguriert
- **navidromeSync.flush/Debounce:** Fake-Timer; mehrere `markDirty` koaleszen zu einem Flush nach 60 s; Flush-Guard (parallele Flushe duplizieren keine Syncs); `syncAll`
- **Routes:** `test-navidrome` + `navidrome-sync/now` (Admin-Auth, unkonfiguriert → 400)

## Rollout

1. Prisma-Migration auf Kimas DB (`npx prisma migrate dev` mit Dev-Postgres aus `docker-compose.dev.yml`).
2. Kima-Fork deployen (übliche Kima-Deploy-Pipeline).
3. In der Kima-UI (Settings → Navidrome Sync): URL eintragen (aus Kima-Container z. B. `http://host.docker.internal:4533`, falls Navidrome über Host-Port erreichbar ist — bei getrennten Compose-Projects ggf. Host-IP), Test-Connection, aktivieren.
4. „Sync now" für den Initial-Sync; danach läuft event-basiert (≤ 60 s nach Änderung).

## Offene Punkte / Risiken

- **ISRC-Coverage:** Navidrome füllt `isrc` nur aus Dateitags; Soulseek-Downloads haben evtl. keine → Fallback-Scoring greift (kein Funktionsverlust).
- **Navidrome-Version:** `isrc`-Extension an v0.64 (aktuelles `latest`) validiert; ältere Versionen ohne `isrc`-Field degradieren ebenfalls nur zum Fallback (Feld ist optional im Response).
- **Namens-Collisionen:** Eine manuell gepflegte Navidrome-Playlist mit identischem Namen wird beim Sync überschrieben (delete+create). Bewusst in Kauf genommen (Single-User, Prefix als Schutz möglich).
