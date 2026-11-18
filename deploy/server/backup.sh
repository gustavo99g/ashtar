#!/usr/bin/env bash
# Backup do banco da API no Cloudflare R2. O setup.sh agenda isto todo dia às 22:30.
#
# 1. `admin backup` faz a cópia com VACUUM INTO (seguro com a API no ar) em data/backups,
#    mantendo as 14 mais recentes.
# 2. O rclone espelha data/backups no R2 (sync): o bucket fica com as mesmas 14 cópias.
#
# Variáveis no .env desta pasta:
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET e, opcional, R2_PREFIX (pasta no bucket).
set -euo pipefail

cd "$(dirname "$0")"
get() { sed -n "s/^$1=//p" .env | tail -n1; }

for var in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  if [[ -z "$(get "$var")" ]]; then
    echo "$(date -Is) falta $var no .env" >&2
    exit 1
  fi
done

output="$(docker compose exec -T api admin backup /data/backups)"
echo "$output"
# "Backup em /data/backups/<arquivo>": o caminho dentro do contêiner, que é ./data no host.
file="$(printf '%s\n' "$output" | sed -n 's|^Backup em /data/||p' | tail -n1)"
if [[ -z "$file" || ! -f "data/$file" ]]; then
  echo "$(date -Is) o admin não informou o arquivo do backup" >&2
  exit 1
fi

prefix="$(get R2_PREFIX)"
dest="r2:$(get R2_BUCKET)${prefix:+/$prefix}"

docker run --rm \
  -v "$PWD/data/backups:/backups:ro" \
  -e RCLONE_CONFIG_R2_TYPE=s3 \
  -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
  -e RCLONE_CONFIG_R2_ACCESS_KEY_ID="$(get R2_ACCESS_KEY_ID)" \
  -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$(get R2_SECRET_ACCESS_KEY)" \
  -e RCLONE_CONFIG_R2_ENDPOINT="https://$(get R2_ACCOUNT_ID).r2.cloudflarestorage.com" \
  -e RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true \
  rclone/rclone:1.75.2 sync /backups "$dest"

echo "$(date -Is) $(basename "$file") enviado; $dest espelha data/backups"
