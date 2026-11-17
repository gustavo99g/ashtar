#!/usr/bin/env bash
# Prepara a VPS: Docker, firewall, ajuste de UDP, fuso, e gera .env, livekit.yaml, Caddyfile e api.env.
# Uso (como root, nesta pasta):
#   ./setup.sh <domínio do LiveKit> [domínio da API]
#   ex.: ./setup.sh livekit.ashtar.app.br api.ashtar.app.br
# Rodar de novo é seguro: chave, segredo e o resto do .env e do api.env são mantidos.
# Sem argumentos, usa os domínios que já estão no .env.
set -euo pipefail

cd "$(dirname "$0")"

if [[ $EUID -ne 0 ]]; then
  echo "Rode como root (sudo ./setup.sh <domínio do LiveKit> [domínio da API])." >&2
  exit 1
fi

touch .env
chmod 600 .env

# Lê uma variável de um arquivo KEY=valor (vazio se não existir).
get() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -n1; }
# Grava (ou troca) uma variável num arquivo KEY=valor, sem mexer nas outras.
set_var() {
  local file="$1" key="$2" value="$3"
  if grep -q "^$key=" "$file"; then
    local escaped
    escaped="$(printf '%s' "$value" | sed 's/[&|\\]/\\&/g')"
    sed -i "s|^$key=.*|$key=$escaped|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

livekit_domain="${1:-$(get .env LIVEKIT_DOMAIN)}"
api_domain="${2:-$(get .env API_DOMAIN)}"
if [[ -z "$livekit_domain" ]]; then
  echo "Uso: ./setup.sh <domínio do LiveKit> [domínio da API]" >&2
  exit 1
fi

# --- Docker ---------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "Instalando o Docker..."
  apt-get update
  apt-get install -y docker.io docker-compose-v2
  systemctl enable --now docker
fi

# --- Firewall -------------------------------------------------------------
# 7880 (LiveKit) e 3000 (API) ficam fechadas: só o Caddy, na própria máquina, fala com elas.
if ! command -v ufw >/dev/null 2>&1; then
  apt-get install -y ufw
fi
ufw allow OpenSSH
ufw allow 80/tcp     # Let's Encrypt (desafio HTTP) e redirecionamento
ufw allow 443/tcp    # LiveKit (wss://) e API, pelo Caddy
ufw allow 7881/tcp   # mídia por TCP, quando UDP não passa
ufw allow 7882/udp   # mídia por UDP
ufw allow 3478/udp   # TURN
ufw --force enable

# --- Buffers de UDP (recomendação do LiveKit) -----------------------------
cat > /etc/sysctl.d/90-livekit.conf <<'SYSCTL'
net.core.rmem_max = 5000000
net.core.wmem_max = 5000000
SYSCTL
sysctl --system >/dev/null

# --- Fuso: o backup roda às 22:30 de Brasília ------------------------------
timedatectl set-timezone America/Sao_Paulo 2>/dev/null || true

# --- LiveKit --------------------------------------------------------------
key="$(get .env LIVEKIT_API_KEY)"
secret="$(get .env LIVEKIT_API_SECRET)"
if [[ -z "$key" || -z "$secret" ]]; then
  key="API$(openssl rand -hex 6)"
  secret="$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48)"
fi
set_var .env LIVEKIT_DOMAIN "$livekit_domain"
set_var .env LIVEKIT_API_KEY "$key"
set_var .env LIVEKIT_API_SECRET "$secret"

sed -e "s|__LIVEKIT_DOMAIN__|$livekit_domain|" \
    -e "s|__LIVEKIT_API_KEY__|$key|" \
    -e "s|__LIVEKIT_API_SECRET__|$secret|" \
    livekit.yaml.template > livekit.yaml
# Legível pelo usuário do contêiner, qualquer que seja; a VPS só tem o root.
chmod 644 livekit.yaml

# --- API ------------------------------------------------------------------
# API_UPSTREAM: para onde o Caddy manda o api.<domínio>. 127.0.0.1:3000 é a API desta VPS;
# durante a migração, a URL do Funnel de casa (https://<máquina>.<rede>.ts.net).
upstream="$(get .env API_UPSTREAM)"
upstream="${upstream:-127.0.0.1:3000}"

if [[ -n "$api_domain" ]]; then
  set_var .env API_DOMAIN "$api_domain"
  set_var .env API_UPSTREAM "$upstream"
  sed -e "s|__LIVEKIT_DOMAIN__|$livekit_domain|" \
      -e "s|__API_DOMAIN__|$api_domain|" \
      -e "s|__API_UPSTREAM__|$upstream|" \
      -e "s|^#API ||" -e "/^#API$/d" \
      Caddyfile.template > Caddyfile

  # A API só roda aqui quando o Caddy aponta para ela.
  if [[ "$upstream" == "127.0.0.1:3000" ]]; then
    set_var .env COMPOSE_PROFILES api
  else
    set_var .env COMPOSE_PROFILES ""
  fi

  touch api.env
  chmod 600 api.env
  set_var api.env LIVEKIT_URL "wss://$livekit_domain"
  set_var api.env LIVEKIT_API_KEY "$key"
  set_var api.env LIVEKIT_API_SECRET "$secret"
  set_var api.env DATABASE_URL "sqlite://ashtar.db"
  set_var api.env PUBLIC_URL "https://$api_domain"
  grep -q '^MIN_CLIENT_VERSION=' api.env || set_var api.env MIN_CLIENT_VERSION ""

  # O contêiner da API roda como o usuário 10001.
  mkdir -p data
  chown -R 10001 data
else
  sed -e "s|__LIVEKIT_DOMAIN__|$livekit_domain|" -e "/^#API/d" Caddyfile.template > Caddyfile
fi

# --- Backup diário no R2 --------------------------------------------------
cron=/etc/cron.d/ashtar-backup
if [[ -n "$(get .env R2_BUCKET)" && "$(get .env COMPOSE_PROFILES)" == "api" ]]; then
  chmod +x backup.sh
  cat > "$cron" <<CRON
# Backup do banco da API no Cloudflare R2, todo dia às 22:30 (deploy/server/backup.sh).
30 22 * * * root $PWD/backup.sh >> /var/log/ashtar-backup.log 2>&1
CRON
  backup_status="ligado (22:30, log em /var/log/ashtar-backup.log)"
else
  rm -f "$cron"
  backup_status="desligado (falta R2_BUCKET no .env ou a API não roda aqui)"
fi

echo
echo "Pronto."
echo "  LiveKit: wss://$livekit_domain"
if [[ -n "$api_domain" ]]; then
  echo "  API:     https://$api_domain -> $upstream"
fi
echo "  Backup:  $backup_status"
echo
echo "Confira que os domínios apontam para o IP desta VPS e rode: docker compose up -d"
if [[ -z "$api_domain" ]]; then
  echo
  echo "No .env da API (computador de casa):"
  echo "  LIVEKIT_URL=wss://$livekit_domain"
  echo "  LIVEKIT_API_KEY=$key"
  echo "  LIVEKIT_API_SECRET=<o LIVEKIT_API_SECRET do .env desta pasta>"
fi
