#!/usr/bin/env bash
# Génère un certificat auto-signé TLS (signature SHA-256) pour TajNet.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${TAJNET_DATA_DIR:-$ROOT/data}"
TLS_DIR="${TLS_CERT_DIR:-$DATA_DIR/tls}"
CN="${TLS_CN:-localhost}"
DAYS="${TLS_DAYS:-825}"
KEY_BITS="${TLS_KEY_BITS:-2048}"

mkdir -p "$TLS_DIR"

# SAN : localhost + IP LAN optionnelle (TLS_SAN="DNS:localhost,IP:127.0.0.1,IP:192.168.1.76")
SAN="${TLS_SAN:-DNS:localhost,DNS:127.0.0.1,IP:127.0.0.1,IP:::1}"

openssl req -x509 -newkey "rsa:${KEY_BITS}" -sha256 -nodes \
  -keyout "$TLS_DIR/key.pem" \
  -out "$TLS_DIR/cert.pem" \
  -days "$DAYS" \
  -subj "/CN=${CN}/O=TajNet/C=FR" \
  -addext "subjectAltName=${SAN}" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"

chmod 600 "$TLS_DIR/key.pem"
chmod 644 "$TLS_DIR/cert.pem"

echo "Certificats écrits dans $TLS_DIR"
echo "  cert : $TLS_DIR/cert.pem"
echo "  key  : $TLS_DIR/key.pem"
echo ""
echo "Empreinte SHA-256 :"
openssl x509 -in "$TLS_DIR/cert.pem" -noout -fingerprint -sha256
echo ""
echo "Ajoutez dans .env :"
echo "  TLS_ENABLED=true"
echo "  TLS_CERT_FILE=$TLS_DIR/cert.pem"
echo "  TLS_KEY_FILE=$TLS_DIR/key.pem"
echo "  TLS_PORT=8443"
echo "  TLS_HTTP_REDIRECT=true"
echo "  TRUST_PROXY=1"
