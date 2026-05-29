-- Limite de tentatives pour la vérification du PIN de démarrage
ALTER TABLE "rides" ADD COLUMN "pinAttempts" INTEGER NOT NULL DEFAULT 0;
