-- Platform settings (singleton) + hot zones
CREATE TABLE IF NOT EXISTS "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "pricing" JSONB NOT NULL DEFAULT '{}',
    "financials" JSONB NOT NULL DEFAULT '{}',
    "payments" JSONB NOT NULL DEFAULT '{}',
    "security" JSONB NOT NULL DEFAULT '{}',
    "platform" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hot_zones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "surgeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hot_zones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hot_zones_isActive_idx" ON "hot_zones"("isActive");
