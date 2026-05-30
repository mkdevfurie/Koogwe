-- AdminRole + nouvelles tables admin
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'SUPPORT', 'READONLY');
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REFUNDED');
CREATE TYPE "PromoDiscountType" AS ENUM ('PERCENT', 'FIXED');

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "adminRole" "AdminRole";

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" TEXT NOT NULL,
  "adminId" TEXT,
  "adminEmail" TEXT,
  "action" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "metadata" JSONB,
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "disputes" (
  "id" TEXT NOT NULL,
  "rideId" TEXT,
  "reporterId" TEXT,
  "reason" TEXT NOT NULL,
  "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
  "adminNotes" TEXT,
  "refundAmount" DOUBLE PRECISION,
  "rating" INTEGER,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "promo_codes" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT,
  "discountType" "PromoDiscountType" NOT NULL DEFAULT 'PERCENT',
  "discountValue" DOUBLE PRECISION NOT NULL,
  "maxUses" INTEGER,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "validFrom" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "targetRole" "UserRole",
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "faq_entries" (
  "id" TEXT NOT NULL,
  "questionFr" TEXT NOT NULL,
  "questionEn" TEXT,
  "answerFr" TEXT NOT NULL,
  "answerEn" TEXT,
  "category" TEXT NOT NULL DEFAULT 'general',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "faq_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "promo_codes_code_key" ON "promo_codes"("code");
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");
CREATE INDEX IF NOT EXISTS "disputes_status_idx" ON "disputes"("status");
CREATE INDEX IF NOT EXISTS "disputes_createdAt_idx" ON "disputes"("createdAt");
CREATE INDEX IF NOT EXISTS "promo_codes_isActive_idx" ON "promo_codes"("isActive");
CREATE INDEX IF NOT EXISTS "faq_entries_isActive_sortOrder_idx" ON "faq_entries"("isActive", "sortOrder");

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "users" SET "adminRole" = 'SUPER_ADMIN' WHERE "role" = 'ADMIN' AND "adminRole" IS NULL;
