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

echo "   🐳 Démarrage Docker (IPFS + Tajcoin embarqués)…"
docker compose -f docker-compose.yml -f docker-compose.embedded.yml -f docker-compose.public.yml \
  --profile embedded-ipfs --profile embedded-tajcoin up -d --build

PORT="$(grep -E '^PANEL_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 8090)"
PORT="${PORT:-8090}"

echo ""
echo "✅ TajNet public installé"
echo "   Panel : http://127.0.0.1:${PORT}/"
echo "   Bran Web : http://127.0.0.1:${PORT}/bran-web/edit.html"
echo "   Logs : docker compose -f docker-compose.yml -f docker-compose.embedded.yml -f docker-compose.public.yml logs -f core"
