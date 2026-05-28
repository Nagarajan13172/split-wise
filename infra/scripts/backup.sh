#!/bin/sh
# Nightly Postgres backup → encrypt with age → upload to R2 via rclone.
#
# Env (set in /etc/splitwise/.env, picked up by the backup container):
#   POSTGRES_PASSWORD   — DB password (also the API uses it)
#   BACKUP_AGE_RECIPIENT — public age key the dump is encrypted to
#   RCLONE_CONFIG_R2_TYPE=s3
#   RCLONE_CONFIG_R2_PROVIDER=Cloudflare
#   RCLONE_CONFIG_R2_ACCESS_KEY_ID=...
#   RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=...
#   RCLONE_CONFIG_R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
#   RCLONE_CONFIG_R2_REGION=auto
#   BACKUP_BUCKET=splitwise-backups
#   BACKUP_PREFIX=postgres
#
# Restore drill:
#   rclone copy R2:splitwise-backups/postgres/2026-05-27.sql.age.gz /tmp/
#   gunzip /tmp/2026-05-27.sql.age.gz
#   age -d -i ~/age-private.key /tmp/2026-05-27.sql.age | psql -U splitwise -d splitwise

set -eu

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT required (age public key)}"
: "${BACKUP_BUCKET:=splitwise-backups}"
: "${BACKUP_PREFIX:=postgres}"

stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
out="/tmp/splitwise-${stamp}.sql.age.gz"

export PGPASSWORD="$POSTGRES_PASSWORD"
echo "[$(date -u +%FT%TZ)] dumping postgres → ${out}"
pg_dump -h postgres -U splitwise -d splitwise --format=p \
  | age -r "$BACKUP_AGE_RECIPIENT" \
  | gzip -9 > "$out"

size="$(du -h "$out" | cut -f1)"
echo "[$(date -u +%FT%TZ)] uploading ${size} to R2:${BACKUP_BUCKET}/${BACKUP_PREFIX}/"
rclone copy "$out" "R2:${BACKUP_BUCKET}/${BACKUP_PREFIX}/" --s3-no-check-bucket

# Retention: keep 30 days, then delete older.
rclone delete "R2:${BACKUP_BUCKET}/${BACKUP_PREFIX}/" --min-age 30d --s3-no-check-bucket || true

rm -f "$out"
echo "[$(date -u +%FT%TZ)] done"
