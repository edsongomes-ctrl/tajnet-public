#!/usr/bin/env bash
# Déploie TajNet public sur un nœud distant.
# Profils auto :
#   - Tajcoin hôte + pas d'IPFS → embedded-ipfs (ex. Raspberry ARM)
#   - IPFS hôte + pas de Tajcoin → embedded-tajcoin (ex. lastfm)
#   - les deux absents → stack 100 % Docker
#
# Usage : ./scripts/deploy-public-node.sh [nom-nœud|chemin.env] [install_dir]
set -euo pipefail

ENV_ARG="${1:-}"
REMOTE_INSTALL="${2:-~/tajnet-public}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/node-env.sh
source "${ROOT}/scripts/lib/node-env.sh"

ENV_FILE=""
if [ -n "$ENV_ARG" ]; then
  ENV_FILE="$(resolve_node_env "$ENV_ARG" "$ROOT")" || true
fi

if [ -z "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "Usage: $0 <nom-nœud|fichier.env> [install_dir_remote]" >&2
  echo "Exemple : $0 raspberry" >&2
  echo "Format : secrets/nodes/<nom>.env (user, pass, ip, port optionnel)" >&2
  exit 1
fi

read_kv() {
  local key="$1"
  grep -i "^${key}[[:space:]]*:" "$ENV_FILE" | head -1 | sed 's/^[^:]*:[[:space:]]*//' || true
}

SSH_USER="$(read_kv user)"
SSH_PASS="$(read_kv pass)"
SSH_HOST="$(read_kv ip)"
SSH_PORT="$(read_kv port)"
SSH_PORT="${SSH_PORT:-22}"

if [ -z "$SSH_USER" ] || [ -z "$SSH_PASS" ] || [ -z "$SSH_HOST" ]; then
  echo "❌ Fichier credentials incomplet (user, pass, ip requis)" >&2
  exit 1
fi

if ! command -v sshpass >/dev/null 2>&1; then
  echo "❌ sshpass requis (apt install sshpass)" >&2
  exit 1
fi

SOURCE="${TAJNET_PUBLIC_SOURCE:-${ROOT}/dist/tajnet-public}"
if [ ! -d "$SOURCE" ]; then
  echo "→ Build release publique…"
  "$ROOT/scripts/build-public-release.sh"
fi

SSH_OPTS=(-o StrictHostKeyChecking=no -o ConnectTimeout=20 -p "$SSH_PORT")

echo "→ Déploiement TajNet public sur ${SSH_USER}@${SSH_HOST}:${SSH_PORT}…"
echo "   Source : ${SOURCE}"
NODE_SLUG="$(basename "$ENV_FILE" .env)"

export SSHPASS="$SSH_PASS"
SSHPASS="$SSH_PASS" sshpass -e ssh "${SSH_OPTS[@]}" "${SSH_USER}@${SSH_HOST}" \
  "mkdir -p ${REMOTE_INSTALL}"

echo "→ Synchronisation du code (tar)…"
tar -C "$SOURCE" -cf - \
  --exclude=node_modules \
  --exclude=core/node_modules \
  --exclude=.git \
  --exclude=data \
  --exclude=.env \
  --exclude=secrets \
  . | SSHPASS="$SSH_PASS" sshpass -e ssh "${SSH_OPTS[@]}" "${SSH_USER}@${SSH_HOST}" \
  "tar -C ${REMOTE_INSTALL} -xf -"

SSHPASS="$SSH_PASS" sshpass -e ssh "${SSH_OPTS[@]}" "${SSH_USER}@${SSH_HOST}" \
  "bash -s '${REMOTE_INSTALL}' '${NODE_SLUG}'" <<'REMOTE'
set -euo pipefail

INSTALL_DIR="${1/#\~/$HOME}"
NODE_ID="${2:-}"
cd "$INSTALL_DIR"

echo "=== Prérequis Docker ==="
if ! command -v docker >/dev/null 2>&1; then
  echo "   Installation Docker…"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
  if ! docker info >/dev/null 2>&1; then
    sudo docker info >/dev/null
    DOCKER="sudo docker"
  else
    DOCKER="docker"
  fi
else
  DOCKER="docker"
  if ! $DOCKER info >/dev/null 2>&1; then
    DOCKER="sudo docker"
  fi
fi
$DOCKER compose version >/dev/null

echo "=== Détection daemons hôte ==="
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

echo "   IPFS local  : $HAS_IPFS"
echo "   Tajcoin hôte: $HAS_TAJCOIN"

COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.public.yml)
PROFILES=()

if $HAS_IPFS && ! $HAS_TAJCOIN; then
  echo "   Profil : IPFS hôte + Tajcoin Docker (lastfm)"
  COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.host-ipfs.yml -f docker-compose.public.yml)
  PROFILES=(--profile embedded-tajcoin)
elif ! $HAS_IPFS && $HAS_TAJCOIN; then
  echo "   Profil : Tajcoin hôte + IPFS Docker (raspberry)"
  COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.vps.yml -f docker-compose.public.yml)
  PROFILES=(--profile embedded-ipfs)
elif ! $HAS_IPFS && ! $HAS_TAJCOIN; then
  echo "   Profil : stack 100 % Docker"
  COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.embedded.yml -f docker-compose.public.yml)
  PROFILES=(--profile embedded-ipfs --profile embedded-tajcoin)
else
  echo "   Profil : IPFS + Tajcoin sur l'hôte"
fi

echo "=== Configuration .env ==="
if [ ! -f .env ]; then
  cp .env.example .env
fi

ensure_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

ensure_env TAJNET_EDITION public
ensure_env PANEL_PORT 8090
ensure_env IPFS_API_URL http://127.0.0.1:5001
ensure_env IPFS_GATEWAY_URL http://127.0.0.1:8080
ensure_env TAJCOIN_RPC_URL http://127.0.0.1:12107
ensure_env GUARD_BYPASS false
ensure_env DISCOVER_ENABLED false
ensure_env MATOMO_URL ""

if $HAS_TAJCOIN; then
  TAJCOIN_HOME="${TAJCOIN_HOME:-$HOME/.tajcoin}"
  if [ -d "$TAJCOIN_HOME" ]; then
    ensure_env TAJCOIN_HOST_DATADIR "$TAJCOIN_HOME"
    if [ -f "$TAJCOIN_HOME/tajcoin.conf" ]; then
      RPC_USER="$(grep -m1 '^rpcuser=' "$TAJCOIN_HOME/tajcoin.conf" | cut -d= -f2- || true)"
      RPC_PASS="$(grep -m1 '^rpcpassword=' "$TAJCOIN_HOME/tajcoin.conf" | cut -d= -f2- || true)"
      [ -n "$RPC_USER" ] && ensure_env TAJCOIN_RPC_USER "$RPC_USER"
      [ -n "$RPC_PASS" ] && ensure_env TAJCOIN_RPC_PASSWORD "$RPC_PASS"
      grep -q '^rpcallowip=127.0.0.1' "$TAJCOIN_HOME/tajcoin.conf" 2>/dev/null \
        || echo 'rpcallowip=127.0.0.1' >> "$TAJCOIN_HOME/tajcoin.conf"
    fi
  fi
fi

if ! $HAS_TAJCOIN; then
  if [ ! -f Tajcoin/bootstrap-900600.zip ]; then
    echo "   ⬇ Bootstrap Tajcoin…"
    ./scripts/fetch-bootstrap.sh
  fi
fi

NODE_ID="${2:-}"
apply_preset() {
  local preset_file="$1"
  local label="$2"
  [ -f "$preset_file" ] || return 0
  echo "   ${label}"
  if mkdir -p data/landing 2>/dev/null; then
    cp "$preset_file" data/landing/profile.json
    chmod 600 data/landing/profile.json 2>/dev/null || true
  else
    sudo mkdir -p data/landing
    sudo cp "$preset_file" data/landing/profile.json
    sudo chown "$USER:$USER" data/landing/profile.json 2>/dev/null || true
    chmod 600 data/landing/profile.json 2>/dev/null || true
  fi
}
case "$NODE_ID" in
  lastfm|lastfmnode)
    apply_preset panel/landing/presets/lastfm.profile.json \
      "🎵 Preset landing Last·FM (Echo · Abel · Scriptor)…"
    ;;
  raspberry)
    apply_preset panel/landing/presets/raspberry.profile.json \
      "📜 Preset landing Raspberry (Tamara · Olga · Anna)…"
    ;;
esac

echo "=== Build & démarrage ==="
$DOCKER compose "${COMPOSE_FILES[@]}" "${PROFILES[@]}" up -d --build

echo "=== Attente API ==="
for i in $(seq 1 24); do
  if curl -sf "http://127.0.0.1:8090/api/status" >/dev/null 2>&1; then
    echo "   API prête (tentative ${i})"
    break
  fi
  if [ "$i" -eq 10 ]; then
    echo "   Redémarrage taj-core…"
    $DOCKER restart taj-core 2>/dev/null || true
  fi
  sleep 5
done

echo "=== Statut ==="
$DOCKER ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'taj-|NAMES' || $DOCKER ps
echo "---"
curl -sf "http://127.0.0.1:8090/api/status" | head -c 500 || echo "API pas encore prête"
echo ""
REMOTE

echo ""
echo "✅ Déploiement public terminé."
echo "   Panel : http://${SSH_HOST}:8090/"
echo "   Bran Web : http://${SSH_HOST}:8090/bran-web/edit.html"
