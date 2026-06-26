#!/bin/sh
set -e

PLUGINS_DIR="${PLUGINS_DIR:-/tajnet/plugins}"
TAJCOIN_DATA_DIR="${TAJCOIN_DATA_DIR:-/data/tajcoin}"
TLS_DIR="${TAJNET_DATA_DIR:-/tajnet/data}/tls"
TLS_CERT="${TLS_CERT_FILE:-$TLS_DIR/cert.pem}"
TLS_KEY="${TLS_KEY_FILE:-$TLS_DIR/key.pem}"

if [ ! -d "$TAJCOIN_DATA_DIR" ]; then
  echo "🌿 Initialisation datadir Tajcoin (wallet + chaîne)..."
  mkdir -p "$TAJCOIN_DATA_DIR"
fi

if [ ! -d "$PLUGINS_DIR" ]; then
  echo "⚙️  Création du répertoire plugins..."
  mkdir -p "$PLUGINS_DIR"
fi

if [ "$TLS_ENABLED" = "true" ] && [ ! -f "$TLS_CERT" ]; then
  echo "🔐 Génération certificat TLS (SHA-256)..."
  mkdir -p "$(dirname "$TLS_CERT")"
  TLS_CERT_DIR="$(dirname "$TLS_CERT")" /bin/sh /tajnet/scripts/generate-tls-cert.sh
fi

echo "🚀 Démarrage du moteur TajNet..."
exec node /tajnet/bridge.js
