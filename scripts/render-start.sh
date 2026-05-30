#!/bin/sh
set -e

# Neon + Render : le verrou advisory Prisma expire souvent en 10s par défaut
export PRISMA_MIGRATE_ADVISORY_LOCK_TIMEOUT="${PRISMA_MIGRATE_ADVISORY_LOCK_TIMEOUT:-120000}"

echo "[start] Attente base Neon (réveil)..."
sleep 3

attempt=1
max_attempts=5

while [ "$attempt" -le "$max_attempts" ]; do
  echo "[start] prisma migrate deploy — tentative $attempt/$max_attempts"
  if npx prisma migrate deploy; then
    echo "[start] Migrations OK"
    break
  fi

  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "[start] Échec migrations après $max_attempts tentatives"
    exit 1
  fi

  wait=$((attempt * 8))
  echo "[start] Nouvelle tentative dans ${wait}s (verrou advisory ou cold start Neon)..."
  sleep "$wait"
  attempt=$((attempt + 1))
done

echo "[start] Démarrage NestJS..."
exec node dist/main.js
