# Kima → Navidrome Playlist-Sync: Per-User-Ziele (zusätzlich zum Global-Target)

**Datum:** 2026-09-26
**Status:** Entwurf (nach User-Review 2026-09-26)
**Vorläufer:** `2026-09-20-navidrome-playlist-sync-design.md` (Single-User-Sync, „Multi-User / per-User Navidrome-Credentials" dort Out of Scope)

## Ziel

Kima-Nutzer können in ihren **persönlichen** Settings ein **zusätzliches** Navidrome-Ziel
(_URL, Navidrome-User, Passwort, Prefix_) für **ihre eigenen** Playlists konfigurieren.
Die globale (Admin-)Config bleibt unverändert das **primäre** Ziel: Solange sie aktiv
und vollständig konfiguriert ist, landen die Playlists **aller** Nutzer dort — unabhängig
davon, ob ein Nutzer persönliche Ziele angelegt hat.

## Semantik (freigegebene Entscheidungen)

| # | Entscheidung |
|---|--------------|
| 1 | Global-Target bleibt primär und unverändert: alle Playlisten aller Nutzer, steuerung via bestehender Admin-Settings (an/aus, URL, User, Passwort, Prefix). |
| 2 | Persönliches Ziel ist ein **zusätzliches** Ziel: Ein Kima-Nutzer mit aktivierten, vollständigen persönlichen Settings bekommt seine eigenen Playlists **zusätzlich** im konfigurierten Navidrome-Konto gespiegelt. |
| 3 | Beide Ziele sind **unabhängig**: Global aus → persönliche Ziele syncen weiter; Nutzer ohne persönliche Config → nur Global. Kein Override, kein Opt-out vom Global-Target. |
| 4 | Persönliche Settings gelten **nur** für die Playlisten des jeweiligen Kima-Nutzers (`Playlist.userId`). |
| 5 | Sync-Logik bleibt unverändert: Matching (ISRC-first + Scoring), 60s-Debounce-Flush, delete+create pro Ziel, 0-Matches-skip, keine Lösch-Semantik (Kima-Delete/Rename unverändert). |
| 6 | Ziel-Deduplizierung pro Playlist: Identische Ziel-Settings (gleiche URL, gleicher Navidrome-User, gleicher Prefix, case-insensitiv) werden nur **einmal** gesynct. |

## Kontext (aktueller Stand)

- `SystemSettings` (DB-Zeile `id="default"`, Admin-only via `systemSettings.ts`, Router-Level `requireAdmin`): `navidromeSyncEnabled`, `navidromeUrl`, `navidromeUser`, `navidromePassword` (AES, `safeDecrypt`-Liste), `navidromeNamePrefix`.
- `services/navidromeSync.ts`: `markDirty()` (in-memory Set, nie thrown) → 60s-Intervall-Flush (`unref()`), Flush-Guard, `inFlight`-Dedup pro `playlistId`, `syncPlaylist()` (Settings → Playlist+Items → Mix/leer-skip → Matching → Name = `prefix + name` → `getPlaylists`/`deletePlaylist` → `createPlaylist`), `syncAll()` (alle `mixId = null`), `testConnection()`.
- Hook-Punkte (unverändert): `routes/playlists.ts` (create/rename/add/remove/reorder), `services/spotifyImport.ts` (Import-Ende, Reconcile).
- Admin-Endpunkte in `systemSettings.ts`: `POST /test-navidrome`, `POST /navidrome-sync/now`.
- Pro-User-Tabelle-Muster: `UserDiscoverConfig` (unique `userId`, Cascade).
- UI: `NavidromeSyncSection.tsx` (Admin, Settings-Seite `app/settings/page.tsx` mit Sidebar-Items + `adminOnly`-Flag), `lib/api.ts` (`testNavidrome()`, `syncNavidromeNow()`), `useSystemSettings.ts`.
- `routes/settings.ts` hat bereits Router-Level `requireAuth` (passende Heimat für per-User-Endpunkte).

## Komponenten

### 1. Prisma: `UserNavidromeSettings`

Neues Modell (Muster `UserDiscoverConfig`):

```prisma
model UserNavidromeSettings {
  id              String   @id @default(cuid())
  userId          String   @unique
  enabled         Boolean  @default(false)
  url             String?
  navidromeUser   String?
  navidromePassword String?
  namePrefix      String   @default("")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

+ Relation auf `User`: `navidromeSettings UserNavidromeSettings?`.
Migration via `prisma migrate dev` (Prod: `migrate-safe.sh` beim Backend-Start).

### 2. Settings-Zugriff (per User)

Neue Datei `utils/userNavidromeSettings.ts` (sauberer Trennung gegenüber `systemSettings.ts`):

- `getUserNavidromeSettings(userId)`: In-memory-Cache `Map<userId, {settings | null, ts}>`, TTL 60 s (analog `getSystemSettings`); Passwort via `safeDecrypt`. `null`, wenn keine Zeile existiert.
- `saveUserNavidromeSettings(userId, data)`: Upsert (INSERT … ON CONFLICT `userId` DO UPDATE), Passwort via `encrypt()` (nur wenn angegeben, sonst Bestehendes behalten), Cache-Eintrag des Users invalidieren.

### 3. Per-User-Endpunkte (`routes/settings.ts`, nur `requireAuth` — keine Admin-Logik)

| Endpoint | Verhalten |
|----------|-----------|
| `GET /settings/navidrome-sync/me` | Eigene Settings (Passwort dechiffriert) oder `null` |
| `POST /settings/navidrome-sync/me` | Zod: `{ enabled?: boolean, url?: string \| null, navidromeUser?: string \| null, navidromePassword?: string \| null, namePrefix?: string }` → upsert; `enabled` default `false` bei Neuanlage |
| `POST /settings/navidrome-sync/me/test` | `{ url, username, password }` → `testConnection()` (Pattern Admin-Test) |
| `POST /settings/navidrome-sync/me/sync-now` | Alle **eigenen** Playlisten mit `mixId = null` synchronisieren (frische Settings-Lesung, kein Cache) mit der kompletten Ziel-Liste (Global + persönlich); Ergebnis: flache Liste je Ziel |

Nicht-Admins dürfen also auf genau diese 4 Endpunkte; admin-only bleibt `systemSettings.ts` (Global-Config).

### 4. Sync-Service (`navidromeSync.ts`)

- **Ziel-Liste** neu: `resolveTargets(playlist)` liefert 0–2 Ziele:
  - `global`: aus `getSystemSettings()` (nur wenn `navidromeSyncEnabled` und url/user/password vollständig)
  - `personal:<userId>`: aus `getUserNavidromeSettings(playlist.userId)` (nur wenn `enabled` und url/user/password vollständig)
  - Dedup nach normalisierter `(url, navidromeUser, namePrefix)`-Tupel (URL ohne Trailing-Slash, User/Prefix lowercase).
- `SyncResult` um Feld `target: "global" | "personal"` ergänzt.
- `doSyncPlaylist()`: Bestehende Pipeline **pro Ziel** ausführen (Matching-Run pro Ziel; Search-Cache pro Ziel-Run). Fehler in einem Ziel blockieren das andere nicht; Fehler-Status je Ziel.
- `inFlight`-Key: `${playlistId}::${targetKey}` (gleiche Playlist zu zwei Zielen darf parallel laufen).
- `flush()`/`markDirty`/60s-Retry-Semantik unverändert (fehlgeschlagenes Ziel markiert die Playlist erneut dirty — Retry betrifft alle Ziele).
- `syncAll()` (Admin „Sync now"): Semantik unverändert, Ergebnis jetzt flach je Ziel-Target.
- Unverändert: `skipped_mix`, `skipped_empty`, `skipped_not_configured` (nur, wenn **kein** Ziel auflösbar ist), `skipped_no_matches` (je Ziel — ein Ziel ohne Matches wird gescipped, das andere nicht blockiert), Name = `prefix + playlist.name` **pro Ziel** (unterschiedliche Prefixes erlauben parallele Kopien im selben Konto).

### 5. UI (Frontend)

- Admin: `NavidromeSyncSection.tsx` bleibt unverändert (Global-Config).
- Neu: `PersonalNavidromeSyncSection.tsx` (Pattern `NavidromeSyncSection`), **für alle User** sichtbar (Sidebar-Item ohne `adminOnly`, z. B. Label „Navidrome Sync (persönlich)"):
  - Toggle (enabled), URL, Navidrome-User, Passwort (maskiert), Prefix
  - **Test-Connection**-Button (eigene Test-Endpunkte)
  - **„Meine Playlists jetzt syncen“**-Button (Resultate inline: je Ziel Status/Matched/Total/Missing)
  - Eigener Save-Button; die persönliche Config fließt **nicht** in den Admin-`saveSystemSettings`-Fluss (eigener Zustand/`api`-Calls, Pattern `AccountSection`)
- `lib/api.ts`: `getMyNavidromeSync()`, `saveMyNavidromeSync()`, `testMyNavidromeSync()`, `syncMyNavidromeNow()`; `features/settings/types.ts` um per-User-Form ergänzen.
- Admin „Sync now“-Ansicht: Ergebnisse je Ziel rendern (Target-Spalle/Gruppierung).

### 6. Fehlerbehandlung & Logs

- Alle neuen Pfade werfen nie in den Request-Flow (`markDirty` bleibt fire-and-forget).
- Persönliche Settings „enabled, aber unvollständig" → Ziel wird übersprungen + `logger.warn` (analog Global-Verhalten `[NavidromeSync] enabled but incomplete config …`).
- Per-Ziel-Fehler werden im Log mit Ziel-Label geführt (`[NavidromeSync] … target=global` / `target=personal:<userId>`).
- Navidrome down / 60s-Retry: unverändert, gilt je Ziel.

## Out of Scope

- Mehrere persönliche Ziele pro Nutzer (nur genau eines)
- Opt-out vom Global-Target (bewusst: Global betrifft alle Nutzer)
- Namens-Collisions-Schutz zwischen Kima-Nutzern im selben Navidrome-Konto
- Reverse-Sync, Lösch-Semantik, Pending-Tracks, `isPublic`-Beachtung (alles unverändert)
- Löschen/Reset-Endpunkt für persönliche Settings (Aus = `enabled: false`)
- Frontend-Unit-Tests (Kima-Konvention: Backend-Jest, UI manuell)

## Tests (Jest, Backend)

- **Ziel-Auflösung:** nur Global; nur persönlich; beide; Dedup bei identischer `(url,user,prefix)`-Konfiguration (auch bei unterschiedlicher Großschreibung); unvollständige Configs werden übersprungen.
- **doSyncPlaylist:** ein Ziel 0-Matches → nur dieses Ziel `skipped_no_matches`, zweites Ziel `synced`; inFlight-Keys je Ziel (parallele Ausführung gleicher Playlist zu 2 Zielen).
- **flush/Debounce:** bestehende Tests erweitern (markDirty-Playlist mit 2 Zielen → 2 Sync-Runs).
- **syncAll:** flaches Ergebnis je Ziel.
- **Routes per-User:** nicht-Admin bekommt 200 auf `/settings/navidrome-sync/me` (Auth genügt); GET ohne Config → `null`; POST upsert + Passwort-Verschlüsselung (zweitens: Passwort weggelassen → altes bleibt); `sync-now` synchronisiert nur eigene Playlisten; Admin-`systemSettings`-Endpunkte bleiben unverändert (Admin-only).

## Rollout

1. `prisma migrate dev` (Dev-Postgres, `docker-compose.dev.yml`) + Migration commit.
2. Backend + Frontend deployen (Prod-Migration läuft via `migrate-safe.sh` beim Backend-Start).
3. Global-Setup (Robert) bleibt an — kein Migrationsaufwand für existierende Nutzer.
4. Nutzer (z. B. Anna) legen in Kima → Settings → „Navidrome Sync (persönlich)" ihre Config an, Test-Connection, aktivieren, „Meine Playlists jetzt syncen" für Initial-Sync; danach event-basiert (≤ 60 s).

## Offene Punkte / Risiken

- **Gleiche Playlist-Namen im selben Navidrome-Konto:** Zwei Kima-User mit gleichem Ziel-Konto und gleichem Playlist-Namen (z. B. Anns persönliches Ziel = Roberts Konto mit gleichem Prefix) überschreiben sich gegenseitig (delete+create). Bewusst hingenommen (bekanntes Verhalten aus Vorläufer-Doc); Prefix als Schutz.
- **Cache-Frische:** Persönliche Settings 60 s gecacht — `sync-now` (manuell) liest bewusst frisch; der automatische Flush kann nach einer Config-Änderung bis zu 60 s die alte Config verwenden.
- **ISRC-Coverage / Navidrome-Version:** unverändert aus Vorläufer-Doc (Fallback-Scoring).
