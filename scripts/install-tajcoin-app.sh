#!/usr/bin/env bash
# Extrait tajcoind ou tajcoin-qt depuis applications/ vers un répertoire cible.
# Usage : ./scripts/install-tajcoin-app.sh [tajcoind|tajcoin-qt] [dest_dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPS="${ROOT}/applications"
WHAT="${1:-tajcoind}"
DEST="${2:-${HOME}/bin}"

mkdir -p "$DEST"
arch="$(uname -m)"

pick_tajcoind() {
  case "$arch" in
    aarch64|arm64)
      echo "${APPS}/arm64-v1.1-release/tajcoind-arm64-v1.1.zip"
      ;;
    x86_64|amd64)
      if [ -f "${APPS}/tajcoind-20.04-v1.1.zip" ]; then
        echo "${APPS}/tajcoind-20.04-v1.1.zip"
      else
        echo ""
      fi
      ;;
    *) echo "" ;;
  esac
}

pick_qt() {
  case "$arch" in
    aarch64|arm64)
      if [ -f "${APPS}/arm64-v1.1-release/tajcoin-qt-arm64-v1.1.zip" ]; then
        echo "${APPS}/arm64-v1.1-release/tajcoin-qt-arm64-v1.1.zip"
        return
      fi
      echo "${APPS}/arm64-v1.1-release/tajcoin-qt_1.1.0.0-1_arm64.deb"
      ;;
    x86_64|amd64)
      for candidate in \
        "${APPS}/tajcoin-Qt-Debian_12-v1.1.zip" \
        "${APPS}/tajcoin-Qt-Ubuntu_24-v1.1.zip" \
        "${APPS}/tajcoin-Qt-20.04-v1.1.zip" \
        "${APPS}/tajcoin-Qt-18.04-v1.1.zip"; do
        if [ -f "$candidate" ]; then
          echo "$candidate"
          return
        fi
      done
      echo ""
      ;;
    *) echo "" ;;
  esac
}

extract_zip_bin() {
  local zip="$1" bin="$2"
  local tmp
  tmp="$(mktemp -d)"
  unzip -qo "$zip" -d "$tmp"
  if [ -f "${tmp}/${bin}" ]; then
    install -m 755 "${tmp}/${bin}" "${DEST}/${bin}"
  else
    found="$(find "$tmp" -maxdepth 3 -name "$bin" -type f | head -1)"
    if [ -n "$found" ]; then
      install -m 755 "$found" "${DEST}/${bin}"
    else
      rm -rf "$tmp"
      echo "❌ Binaire ${bin} introuvable dans ${zip}" >&2
      exit 1
    fi
  fi
  rm -rf "$tmp"
}

case "$WHAT" in
  tajcoind)
    src="$(pick_tajcoind)"
    if [ -z "$src" ] || [ ! -f "$src" ]; then
      echo "❌ Aucun tajcoind pour ${arch} dans applications/" >&2
      echo "   Lancez : ./scripts/list-tajcoin-apps.sh" >&2
      exit 1
    fi
    echo "⬇️  ${src} → ${DEST}/tajcoind"
    extract_zip_bin "$src" tajcoind
    ;;
  tajcoin-qt|qt)
    src="$(pick_qt)"
    if [ -z "$src" ] || [ ! -f "$src" ]; then
      echo "❌ Aucun tajcoin-qt pour ${arch} dans applications/" >&2
      exit 1
    fi
    if [[ "$src" == *.deb ]]; then
      echo "📦 Paquet Debian : sudo dpkg -i ${src}"
      echo "   (ou extrayez manuellement usr/bin/tajcoin-qt)"
      exit 0
    fi
    echo "⬇️  ${src} → ${DEST}/tajcoin-qt"
    extract_zip_bin "$src" tajcoin-qt
    ;;
  *)
    echo "Usage: $0 [tajcoind|tajcoin-qt] [dest_dir]" >&2
    exit 1
    ;;
esac

echo "✅ Installé : ${DEST}/${WHAT}"
command -v "${DEST}/${WHAT}" >/dev/null 2>&1 || true
