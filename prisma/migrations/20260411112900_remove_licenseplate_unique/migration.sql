-- DropIndex (idempotent — safe if index was already removed or never created)
DROP INDEX IF EXISTS "driver_profiles_licensePlate_key";
