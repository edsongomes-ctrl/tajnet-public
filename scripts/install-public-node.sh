#!/usr/bin/env bash
# Install TajNet public edition on a fresh Linux node (Docker required).
set -euo pipefail

INSTALL_DIR="${1:-$HOME/tajnet-public}"
REPO="${TAJNET_PUBLIC_REPO:-https://github.com/edsongomes-ctrl/tajnet-public.git}"
BRANCH="${TAJNET_PUBLIC_BRANCH:-main}"

echo "🌿 TajNet public — installation dans ${INSTALL_DIR}"

command -v docker >/dev/null || { echo "❌ Docker requis"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "❌ docker compose requis"; exit 1; }
command -v git >/dev/null || { echo "❌ git requis"; exit 1; }

if [ ! -d "${INSTALL_DIR}/.git" ]; then
  git clone --depth 1 -b "${BRANCH}" "${REPO}" "${INSTALL_DIR}"
else
  echo "   Dépôt déjà présent — git pull"
  git -C "${INSTALL_DIR}" pull --ff-only
fi

cd "${INSTALL_DIR}"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "   ✓ .env créé depuis .env.example"
fi

if [ ! -f Tajcoin/bootstrap-900600.zip ]; then
  echo "   ⬇ Bootstrap Tajcoin (~530 Mo)…"
  ./scripts/fetch-bootstrap.sh
fi

echo "   🐳 Démarrage Docker…"
HAS_IPFS=false
HAS_TAJCOIN=false

if curl -fsS -m 2 http://127.0.0.1:5001/api/v0/id >/dev/null 2>&1 \
  || curl -fsS -m 2 -X POST http://127.0.0.1:5001/api/v0/id >/dev/null 2>&1; then
  HAS_IPFS=true
fi

if pgrep -x tajcoind >/dev/null 2>&1 \
  || ss -tln 2>/dev/null | grep -q ':12107 ' \
  || netstat -tln 2>/dev/null | grep -q ':12107 '; then
  HAS_TAJCOIN=true
fi

COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.public.yml)
PROFILES=()

if [ "$HAS_IPFS" = true ] && [ "$HAS_TAJCOIN" = false ]; then
  echo "   ℹ️  IPFS hôte + Tajcoin Docker (lastfm)"
  COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.host-ipfs.yml -f docker-compose.public.yml)
  PROFILES=(--profile embedded-tajcoin)
elif [ "$HAS_IPFS" = false ] && [ "$HAS_TAJCOIN" = true ]; then
  echo "   ℹ️  Tajcoin hôte + IPFS Docker (raspberry)"
  COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.vps.yml -f docker-compose.public.yml)
  PROFILES=(--profile embedded-ipfs)
  TAJCOIN_HOME="${TAJCOIN_HOME:-$HOME/.tajcoin}"
  if [ -d "$TAJCOIN_HOME" ] && grep -q '^TAJCOIN_HOST_DATADIR=' .env 2>/dev/null; then
    sed -i "s|^TAJCOIN_HOST_DATADIR=.*|TAJCOIN_HOST_DATADIR=${TAJCOIN_HOME}|" .env
  elif [ -d "$TAJCOIN_HOME" ]; then
    echo "TAJCOIN_HOST_DATADIR=${TAJCOIN_HOME}" >> .env
  fi
elif [ "$HAS_IPFS" = false ] && [ "$HAS_TAJCOIN" = false ]; then
  echo "   ℹ️  Stack 100 % Docker (embedded-ipfs + embedded-tajcoin)"
  COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.embedded.yml -f docker-compose.public.yml)
  PROFILES=(--profile embedded-ipfs --profile embedded-tajcoin)
else
  echo "   ℹ️  IPFS + Tajcoin sur l'hôte — core seul"
fi

docker compose "${COMPOSE_FILES[@]}" "${PROFILES[@]}" up -d --build

PORT="$(grep -E '^PANEL_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 8090)"
PORT="${PORT:-8090}"

echo ""
echo "✅ TajNet public installé"
echo "   Panel : http://127.0.0.1:${PORT}/"
echo "   Bran Web : http://127.0.0.1:${PORT}/bran-web/edit.html"
echo "   Logs : docker compose -f docker-compose.yml -f docker-compose.embedded.yml -f docker-compose.public.yml logs -f core"
