#!/usr/bin/env bash
# Backup do banco da API no Cloudflare R2. O setup.sh agenda isto todo dia às 22:30.
#
# 1. `admin backup` faz a cópia com VACUUM INTO (seguro com a API no ar) em data/backups,
#    mantendo as 14 mais recentes.
# 2. O rclone manda a cópia nova para o R2.
# 3. A cópia dos arquivos (v0.9, ADR 0036): `admin arquivos-backup` lista as fotos de perfil, os
#    emojis e os sons, e o rclone sobe para {bucket}/{prefixo}/files/ só os que ainda não estão lá
#    (um arquivo nunca muda). Nada é apagado do R2. Uma falha aqui fica no log e não desfaz o
#    backup do banco, que já subiu. Deu certo, data/backups/arquivos-ok marca a hora e quantos
#    arquivos eram (o Painel › Servidor mostra).
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
dest="r2:$(get R2_BUCKET)${prefix:+/$prefix}/$(basename "$file")"

rclone() {
  docker run --rm \
    -v "$PWD/data:/data:ro" \
    -e RCLONE_CONFIG_R2_TYPE=s3 \
    -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
    -e RCLONE_CONFIG_R2_ACCESS_KEY_ID="$(get R2_ACCESS_KEY_ID)" \
    -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$(get R2_SECRET_ACCESS_KEY)" \
    -e RCLONE_CONFIG_R2_ENDPOINT="https://$(get R2_ACCOUNT_ID).r2.cloudflarestorage.com" \
    -e RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true \
    rclone/rclone:1.75.2 "$@"
}

rclone copyto "/data/backups/$(basename "$file")" "$dest"
echo "$(date -Is) enviado para $dest"

# A cópia dos arquivos. Falhando, o banco já está no R2: só avisa e sai com erro.
files_backup() {
  local list="backups/arquivos.txt"
  docker compose exec -T api admin arquivos-backup "/data/$list" || return 1
  local count
  count="$(grep -c . "data/$list" || true)"
  rclone copy /data/files "r2:$(get R2_BUCKET)${prefix:+/$prefix}/files" \
    --files-from "/data/$list" --ignore-existing --no-traverse || return 1
  echo "$count" > data/backups/arquivos-ok
  echo "$(date -Is) arquivos conferidos no R2: $count"
}

if ! files_backup; then
  echo "$(date -Is) a cópia dos arquivos falhou; o backup do banco foi enviado" >&2
  exit 1
fi
