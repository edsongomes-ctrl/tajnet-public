#!/usr/bin/env bash
# Télécharge bootstrap-900600.zip (snapshot blockchain Tajcoin) pour TajNet Graine.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/Tajcoin/bootstrap-900600.zip"
URL="${TAJCOIN_BOOTSTRAP_URL:-https://github.com/Taj-Coin/tajcoin/releases/download/v1.1/bootstrap-900600.zip}"

if [ -f "$OUT" ]; then
  echo "✅ Bootstrap déjà présent : $OUT"
  exit 0
fi

echo "ℹ️  Les binaires tajcoind/Qt sont dans applications/ (pas le bootstrap)."

mkdir -p "$(dirname "$OUT")"
echo "⬇️  Téléchargement bootstrap Tajcoin (~530 Mo)…"
echo "   $URL"

if command -v wget >/dev/null 2>&1; then
  wget -O "$OUT" "$URL"
elif command -v curl >/dev/null 2>&1; then
  curl -fsSL -o "$OUT" "$URL"
else
  echo "❌ Installez wget ou curl, ou placez le fichier manuellement dans Tajcoin/" >&2
  exit 1
fi

echo "✅ Bootstrap enregistré : $OUT"
