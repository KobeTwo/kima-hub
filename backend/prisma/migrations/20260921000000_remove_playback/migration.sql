-- Remove audio playback from Kima: Navidrome is the player.
-- Destructive: drops all playback/audiobook/podcast/subsonic tables plus
-- now-orphaned config columns (accepted data loss, see docs/superpowers/specs/2026-07-09-remove-playback-design.md).

-- Drop playback-related tables (referencing tables before referenced tables;
-- dependent FKs are dropped automatically by Postgres)
DROP TABLE "PodcastProgress";
DROP TABLE "PodcastDownload";
DROP TABLE "PodcastSubscription";
DROP TABLE "PodcastEpisode";
DROP TABLE "Podcast";
DROP TABLE "AudiobookProgress";
DROP TABLE "Audiobook";
DROP TABLE "Play";
DROP TABLE "PlaybackState";
DROP TABLE "ListeningState";
DROP TABLE "podcast_recommendations";
DROP TABLE "subsonic_bookmarks";
DROP TABLE "subsonic_play_queue";
DROP TABLE "DeviceLinkCode";
DROP TABLE "TranscodedFile";
DROP TABLE "CachedTrack";
DROP TABLE "UserSettings";
DROP TYPE "ListenSource";

-- Drop share play-limit columns
ALTER TABLE "share_links" DROP COLUMN "maxPlays";
ALTER TABLE "share_links" DROP COLUMN "playCount";

-- Drop orphaned playback config columns (no remaining code reads these)
ALTER TABLE "SystemSettings" DROP COLUMN "audiobookshelfEnabled";
ALTER TABLE "SystemSettings" DROP COLUMN "audiobookshelfUrl";
ALTER TABLE "SystemSettings" DROP COLUMN "audiobookshelfApiKey";
ALTER TABLE "SystemSettings" DROP COLUMN "transcodeCacheMaxGb";
ALTER TABLE "DiscoveryTrack" DROP COLUMN "lastPlayedAt";
