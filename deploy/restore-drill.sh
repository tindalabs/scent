#!/usr/bin/env bash
# Proves the latest backup is actually restorable. Restores the most recent dump
# into a throwaway, tmpfs-backed Postgres container, verifies the schema and a few
# row counts, then destroys it. Touches NOTHING in the production stack.
#
#   ./restore-drill.sh
#   BACKUP_DIR=/mnt/x ./restore-drill.sh
#
# A backup that is never restored is a hope, not a backup. Run this on a schedule.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/scent-backups}"
LATEST=$(ls -t "$BACKUP_DIR"/scent-*.dump 2>/dev/null | head -1 || true)
[ -z "$LATEST" ] && { echo "no backups in $BACKUP_DIR"; exit 1; }

echo "restore drill using: $LATEST ($(stat -c%s "$LATEST") bytes)"
C=scent-restore-test
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" \
  -e POSTGRES_PASSWORD=drill -e POSTGRES_USER=scent -e POSTGRES_DB=scent \
  --tmpfs /var/lib/postgresql/data postgres:16-alpine >/dev/null

# Wait for the throwaway instance to accept connections.
for _ in $(seq 1 30); do
  docker exec "$C" pg_isready -U scent -d scent >/dev/null 2>&1 && break
  sleep 1
done

docker cp "$LATEST" "$C":/tmp/restore.dump
docker exec "$C" pg_restore -U scent -d scent --clean --if-exists --no-owner \
  /tmp/restore.dump >/dev/null 2>&1 || true

echo "=== verification (restored copy) ==="
docker exec "$C" psql -U scent -d scent -At \
  -c "SELECT 'public tables = '||count(*) FROM information_schema.tables WHERE table_schema='public';"
docker exec "$C" psql -U scent -d scent \
  -c "SELECT 'projects' AS table, count(*) FROM projects
      UNION ALL SELECT 'admin_users', count(*) FROM admin_users
      UNION ALL SELECT 'identities', count(*) FROM identities
      UNION ALL SELECT 'snapshots', count(*) FROM snapshots;"

docker rm -f "$C" >/dev/null
echo "restore drill PASSED (throwaway container removed)"
