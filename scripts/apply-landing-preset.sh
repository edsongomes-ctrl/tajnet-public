#!/usr/bin/env bash
# Applique un preset landing (ex. lastfm → thème musique + agents Echo/Abel/Scriptor).
# Usage : ./scripts/apply-landing-preset.sh [lastfm] [data_dir]
set -euo pipefail

PRESET="${1:-lastfm}"
DATA_DIR="${2:-$(cd "$(dirname "$0")/.." && pwd)/data}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/panel/landing/presets/${PRESET}.profile.json"
DEST="${DATA_DIR}/landing/profile.json"

if [ ! -f "$SRC" ]; then
  echo "❌ Preset introuvable : ${SRC}" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
cp "$SRC" "$DEST"
chmod 600 "$DEST" 2>/dev/null || true

echo "✅ Preset « ${PRESET} » → ${DEST}"
echo "   theme=$(grep -o '"theme"[[:space:]]*:[[:space:]]*"[^"]*"' "$DEST" | head -1)"
