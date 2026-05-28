-- RIB chauffeur pour retraits
ALTER TABLE "driver_profiles" ADD COLUMN IF NOT EXISTS "bankAccountHolder" TEXT;
ALTER TABLE "driver_profiles" ADD COLUMN IF NOT EXISTS "bankIban" TEXT;
ALTER TABLE "driver_profiles" ADD COLUMN IF NOT EXISTS "bankBic" TEXT;
