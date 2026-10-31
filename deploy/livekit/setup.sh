#!/usr/bin/env bash
# Prepara a VPS para o LiveKit: Docker, firewall, ajuste de UDP, .env e livekit.yaml.
# Uso (como root, na pasta deploy/livekit da VPS):
#   ./setup.sh livekit.seudominio.com
# Rodar de novo é seguro: a chave e o segredo já gerados são mantidos.
set -euo pipefail

cd "$(dirname "$0")"

if [[ $EUID -ne 0 ]]; then
  echo "Rode como root (sudo ./setup.sh <domínio>)." >&2
  exit 1
fi

domain="${1:-}"
if [[ -z "$domain" && -f .env ]]; then
  domain="$(sed -n 's/^LIVEKIT_DOMAIN=//p' .env)"
fi
if [[ -z "$domain" ]]; then
  echo "Uso: ./setup.sh <domínio do LiveKit>   (ex.: livekit.seudominio.com)" >&2
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
# 7880 (sinal sem TLS) fica fechada: só o Caddy, na própria máquina, fala com ela.
if ! command -v ufw >/dev/null 2>&1; then
  apt-get install -y ufw
fi
ufw allow OpenSSH
ufw allow 80/tcp     # Let's Encrypt (desafio HTTP) e redirecionamento
ufw allow 443/tcp    # sinal do LiveKit (wss://) pelo Caddy
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

# --- Chave, segredo e config ----------------------------------------------
if [[ -f .env ]] && grep -q '^LIVEKIT_API_KEY=' .env; then
  key="$(sed -n 's/^LIVEKIT_API_KEY=//p' .env)"
  secret="$(sed -n 's/^LIVEKIT_API_SECRET=//p' .env)"
else
  key="API$(openssl rand -hex 6)"
  secret="$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48)"
fi

umask 077
cat > .env <<ENV
LIVEKIT_DOMAIN=$domain
LIVEKIT_API_KEY=$key
LIVEKIT_API_SECRET=$secret
ENV

sed -e "s|__LIVEKIT_DOMAIN__|$domain|" \
    -e "s|__LIVEKIT_API_KEY__|$key|" \
    -e "s|__LIVEKIT_API_SECRET__|$secret|" \
    livekit.yaml.template > livekit.yaml
# Legível pelo usuário do contêiner, qualquer que seja; a VPS só tem o root.
chmod 644 livekit.yaml
umask 022

echo
echo "Pronto. Agora:"
echo "  1. Confira que $domain aponta para o IP desta VPS."
echo "  2. docker compose up -d"
echo "  3. No .env da API (computador de casa):"
echo
echo "     LIVEKIT_URL=wss://$domain"
echo "     LIVEKIT_API_KEY=$key"
echo "     LIVEKIT_API_SECRET=$secret"
