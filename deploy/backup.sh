#!/usr/bin/env bash
# Scheduled Postgres backup for the single-VPS scent stack. Takes a custom-format
# (-Fc) dump via pg_dump inside the running postgres container, validates it, and
# rotates out dumps older than RETAIN_DAYS. Cron-friendly (no TTY needed).
#
#   ./backup.sh                      # dump into ~/scent-backups, keep 14 days
#   BACKUP_DIR=/mnt/x RETAIN_DAYS=30 ./backup.sh
#
# NOTE: these dumps land on the same host. For true disaster recovery (whole-box
# loss) also enable off-box backups (e.g. Hetzner automated VM snapshots, or ship
# this dump to a Storage Box / S3 with restic).
set -euo pipefail

# Run compose from this script's own directory (where docker-compose.yml lives).
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/scent-backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/scent-${TS}.dump"

cd "$DEPLOY_DIR"
echo "[$(date -Is)] backup start -> $OUT"
docker compose exec -T postgres pg_dump -U scent -d scent -Fc > "$OUT"

SIZE=$(stat -c%s "$OUT")
if [ "$SIZE" -lt 1000 ]; then
  echo "[$(date -Is)] ERROR: dump only ${SIZE} bytes - removing and failing" >&2
  rm -f "$OUT"
  exit 1
fi
echo "[$(date -Is)] OK ${SIZE} bytes"

find "$BACKUP_DIR" -name 'scent-*.dump' -mtime +"$RETAIN_DAYS" -print -delete \
  | sed 's/^/[rotated] /' || true
echo "[$(date -Is)] current backups:"
ls -1t "$BACKUP_DIR"/scent-*.dump
