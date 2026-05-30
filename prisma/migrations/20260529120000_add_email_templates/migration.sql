-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "emails" JSONB NOT NULL DEFAULT '{}';
