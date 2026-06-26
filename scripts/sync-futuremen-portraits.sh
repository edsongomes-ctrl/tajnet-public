#!/usr/bin/env bash
# Copie les portraits Futuremen vers le thème landing musique.
# Source par défaut : ~/Documents/Cursor/Futuremen/media
# Usage : ./scripts/sync-futuremen-portraits.sh [source_dir]
set -euo pipefail

SRC="${1:-${FUTUREMEN_MEDIA:-$HOME/Documents/Cursor/Futuremen/media}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ROOT}/panel/landing/themes/music/agents"

if [ ! -d "$SRC" ]; then
  echo "❌ Dossier source introuvable : ${SRC}" >&2
  exit 1
fi

mkdir -p "$DEST"
for name in echo abel scriptor; do
  if [ -f "${SRC}/${name}.jpg" ]; then
    cp "${SRC}/${name}.jpg" "${DEST}/${name}.jpg"
    echo "   ✓ music/${name}.jpg"
  fi
done

FM_AGENTS="${ROOT}/panel/futuremen/agents"
mkdir -p "$FM_AGENTS"
for name in michael nova circuit echo vortex pulse anna olga abel scriptor tamara; do
  if [ -f "${SRC}/${name}.jpg" ]; then
    cp "${SRC}/${name}.jpg" "${FM_AGENTS}/${name}.jpg"
    echo "   ✓ futuremen/${name}.jpg"
  fi
done

HERITAGE_DEST="$(cd "$(dirname "$0")/.." && pwd)/panel/landing/themes/heritage/agents"
mkdir -p "$HERITAGE_DEST"
for name in tamara olga anna; do
  if [ -f "${SRC}/${name}.jpg" ]; then
    cp "${SRC}/${name}.jpg" "${HERITAGE_DEST}/${name}.jpg"
    echo "   ✓ heritage/${name}.jpg"
  else
    echo "   ⚠️  ${name}.jpg absent dans ${SRC}" >&2
  fi
done
echo "✅ Portraits → music/ heritage/ futuremen/agents/"
