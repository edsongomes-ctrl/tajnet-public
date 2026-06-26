#!/usr/bin/env bash
# Affiche les binaires Tajcoin v1.1 disponibles dans applications/ pour cette machine.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPS="${ROOT}/applications"

arch="$(uname -m)"
os="$(uname -s)"

echo "=== Applications Tajcoin (applications/) ==="
echo "Machine : ${os} / ${arch}"
echo ""

if [ -d "$APPS" ]; then
  find "$APPS" -maxdepth 2 \( -name '*.zip' -o -name '*.deb' \) ! -name '*unstripped*' ! -name '*.torrent' \
    | sort \
    | while read -r f; do
      rel="${f#"${APPS}/"}"
      printf '  • %s\n' "$rel"
    done
else
  echo "  (dossier applications/ absent)"
fi

echo ""
echo "Bootstrap blockchain (~530 Mo) — NON inclus, téléchargement officiel :"
echo "  ./scripts/fetch-bootstrap.sh"
echo "  https://github.com/Taj-Coin/tajcoin/releases/download/v1.1/bootstrap-900600.zip"
echo ""

case "$arch" in
  aarch64|arm64)
    echo "Recommandé (ARM64) :"
    echo "  applications/arm64-v1.1-release/tajcoind-arm64-v1.1.zip"
    echo "  applications/arm64-v1.1-release/tajcoin-qt_1.1.0.0-1_arm64.deb"
    ;;
  x86_64|amd64)
    echo "Recommandé (x86_64) :"
    echo "  applications/tajcoin-Qt-Debian_12-v1.1.zip   (Debian 12 / récent)"
    echo "  applications/tajcoin-Qt-20.04-v1.1.zip       (Ubuntu 20.04)"
    if [ -f /etc/os-release ]; then
      # shellcheck disable=SC1091
      . /etc/os-release
      echo "  (détecté : ${NAME:-Linux} ${VERSION_ID:-?})"
    fi
    ;;
  *)
    echo "Architecture non couverte par défaut — parcourir applications/ manuellement."
    ;;
esac
