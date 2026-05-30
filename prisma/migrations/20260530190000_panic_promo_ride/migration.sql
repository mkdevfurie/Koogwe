CREATE TYPE "PanicStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'FALSE_ALARM');

CREATE TABLE IF NOT EXISTS "panic_alerts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rideId" TEXT,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "note" TEXT,
  "status" "PanicStatus" NOT NULL DEFAULT 'ACTIVE',
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "panic_alerts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "promoCodeId" TEXT;
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "discountAmount" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "panic_alerts_status_createdAt_idx" ON "panic_alerts"("status", "createdAt");

ALTER TABLE "panic_alerts" ADD CONSTRAINT "panic_alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "panic_alerts" ADD CONSTRAINT "panic_alerts_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "panic_alerts" ADD CONSTRAINT "panic_alerts_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rides" ADD CONSTRAINT "rides_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
