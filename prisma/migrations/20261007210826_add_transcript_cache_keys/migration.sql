-- AlterTable: Add new cache key columns and base summary fields
-- For existing rows, defaults are applied automatically:
--   captionLanguage = "en"
--   pipelineVersion = 1
--   baseSummary = NULL
--   summaryPromptVersion = NULL

-- Add source column if it doesn't exist (was added in a previous undocumented migration)
-- This is idempotent: if column exists, the statement is ignored
ALTER TABLE "Video" ADD COLUMN "source" TEXT DEFAULT 'youtube_captions';

-- Add platform column if it doesn't exist (was added in a previous undocumented migration)
ALTER TABLE "Video" ADD COLUMN "platform" TEXT DEFAULT 'youtube';

-- Add new cache key columns
ALTER TABLE "Video" ADD COLUMN "captionLanguage" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "Video" ADD COLUMN "pipelineVersion" INTEGER NOT NULL DEFAULT 1;

-- Add base summary caching columns
ALTER TABLE "Video" ADD COLUMN "baseSummary" TEXT;
ALTER TABLE "Video" ADD COLUMN "summaryPromptVersion" INTEGER;

-- Drop old unique index on videoId only
DROP INDEX IF EXISTS "Video_videoId_key";

-- Create new composite unique index on (videoId, captionLanguage, pipelineVersion)
CREATE UNIQUE INDEX "Video_videoId_captionLanguage_pipelineVersion_key" ON "Video"("videoId", "captionLanguage", "pipelineVersion");
