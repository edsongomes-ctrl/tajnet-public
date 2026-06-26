#!/usr/bin/env bash
# Restreint l'accès au répertoire secrets/ (propriétaire edson, 700/600).
# Usage : ./scripts/secure-secrets.sh [utilisateur]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="${ROOT}/secrets"
OWNER="${1:-edson}"

if [ ! -d "$SECRETS" ]; then
  echo "❌ Répertoire absent : ${SECRETS}" >&2
  exit 1
fi

if id "$OWNER" >/dev/null 2>&1; then
  if [ "$(id -un)" = "root" ] || [ "$(id -un)" = "$OWNER" ]; then
    chown -R "${OWNER}:${OWNER}" "$SECRETS" 2>/dev/null || \
      echo "⚠️  chown ${OWNER} ignoré (droits insuffisants ou utilisateur absent)" >&2
  else
    echo "⚠️  Relancez avec sudo pour chown ${OWNER} : sudo $0 ${OWNER}" >&2
  fi
else
  echo "⚠️  Utilisateur « ${OWNER} » introuvable — chown ignoré" >&2
fi

find "$SECRETS" -type d -exec chmod 700 {} +
find "$SECRETS" -type f \( -name '*.env' -o -name '*.txt' -o -name 'GitHub.*' -o -name 'github.*' \) -exec chmod 600 {} +
find "$SECRETS" -type f \( -name '*.example' -o -name 'README.md' -o -name '.gitkeep' \) -exec chmod 644 {} +

# .env local TajNet (config Docker — peut contenir RPC)
LOCAL_ENV="${ROOT}/.env"
if [ -f "$LOCAL_ENV" ]; then
  chmod 600 "$LOCAL_ENV"
  if id "$OWNER" >/dev/null 2>&1 && { [ "$(id -un)" = "root" ] || [ "$(id -un)" = "$OWNER" ]; }; then
    chown "${OWNER}:${OWNER}" "$LOCAL_ENV" 2>/dev/null || true
  fi
fi

echo "✅ Permissions secrets/ (cible : ${OWNER})"
find "$SECRETS" \( -type d -o -type f \) -printf '   %m %u:%g %p\n' 2>/dev/null | head -25 \
  || ls -la "$SECRETS/nodes/"
