#!/usr/bin/env bash
# Build a clean public TajNet tree (birth release) — no private data, Bran Web only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-${ROOT}/dist/tajnet-public}"
VERSION="${2:-1.0.0}"

echo "🌿 TajNet public release v${VERSION}"
echo "   Source : ${ROOT}"
echo "   Output : ${OUT}"

rm -rf "${OUT}"
mkdir -p "${OUT}"

RSYNC_EXCLUDES=(
  --exclude '.git/'
  --exclude '.cursor/'
  --exclude '.env'
  --exclude '.env.local'
  --exclude 'GitHub.txt'
  --exclude 'secrets/'
  --exclude 'credentials.env'
  --exclude 'synchro_nas.sh'
  --exclude 'dist/'
  --exclude 'node_modules/'
  --exclude 'core/node_modules/'
  --exclude 'Editeur GrapeJS/'
  --exclude 'brain/'
  --exclude 'fixtures/'
  --exclude 'panel/cv/'
  --exclude 'panel/futuremen/'
  --exclude 'panel/pulse/'
  --exclude 'plugins/super-cv/'
  --exclude 'scripts/test-super-cv.js'
  --exclude 'scripts/deploy-vps.sh'
  --exclude 'scripts/enable-vps-domain.sh'
  --exclude 'scripts/enable-vps-tls.sh'
  --exclude 'data/'
  --exclude '/wallet/'
  --exclude 'Tajcoin/data/'
  --exclude 'Tajcoin/bootstrap-900600.zip'
  --exclude 'Tajcoin/tajcoin-master.zip'
  --exclude 'Tajcoin/source/'
  --exclude 'applications/**/*.torrent'
  --exclude 'applications/**/*unstripped*'
  --exclude 'README.md'
  --exclude 'panel/landing/index.html'
  --exclude 'plugins/bran-web/templates/'
)

rsync -a --no-owner --no-group "${RSYNC_EXCLUDES[@]}" "${ROOT}/" "${OUT}/"

# Public docs as primary README
cp "${ROOT}/README-PUBLIC.md" "${OUT}/README.md"
cp "${ROOT}/PLUGINS.md" "${OUT}/PLUGINS.md"
cp "${ROOT}/PREMIERE-INSTALLATION.md" "${OUT}/PREMIERE-INSTALLATION.md" 2>/dev/null || true

# Landing = birth page (multilingual)
mkdir -p "${OUT}/panel/landing"
cp "${ROOT}/panel/landing/public/index.html" "${OUT}/panel/landing/index.html"
cp "${ROOT}/panel/landing/public.css" "${OUT}/panel/landing/public.css"
cp "${ROOT}/panel/landing/public.js" "${OUT}/panel/landing/public.js"
cp "${ROOT}/panel/landing/landing.css" "${OUT}/panel/landing/landing.css" 2>/dev/null || true

# Empty runtime dirs
mkdir -p "${OUT}/data"/{discover,ipfs,ipfs_uploads,uploads,landing,tls}
mkdir -p "${OUT}/Tajcoin/data" "${OUT}/wallet" "${OUT}/plugins/bran-web/uploads"
touch "${OUT}/data/.gitkeep" "${OUT}/Tajcoin/data/.gitkeep" "${OUT}/wallet/.gitkeep"
touch "${OUT}/plugins/bran-web/uploads/.gitkeep"

# Public .env.example
if grep -q '^TAJNET_EDITION=' "${OUT}/.env.example" 2>/dev/null; then
  sed -i 's|^TAJNET_EDITION=.*|TAJNET_EDITION=public|' "${OUT}/.env.example"
else
  echo 'TAJNET_EDITION=public' >> "${OUT}/.env.example"
fi

# Strip home paths
for f in .env.example docker-compose.yml; do
  [ -f "${OUT}/${f}" ] && sed -i 's|/home/edson|/home/USER|g' "${OUT}/${f}" 2>/dev/null || true
done

# Dockerfile public — Bran Web + i18n, sans panel/cv ni panel/futuremen
cat > "${OUT}/core/docker/Dockerfile" << 'DOCKERFILE'
FROM node:20-alpine

RUN apk add --no-cache curl openssl python3

WORKDIR /tajnet

COPY core/package.json ./
RUN npm install --omit=dev

COPY core/bridge.js ./bridge.js
COPY core/lib ./lib
COPY core/routes ./routes
COPY panel/src ./panel/src
COPY panel/landing ./panel/landing
COPY panel/shared ./panel/shared
COPY panel/editor ./panel/editor
COPY panel/wallet ./panel/wallet
COPY panel/view ./panel/view
COPY plugins ./plugins
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY scripts/generate-tls-cert.sh ./scripts/generate-tls-cert.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /tajnet/scripts/generate-tls-cert.sh

EXPOSE 8090 8443

ENTRYPOINT ["entrypoint.sh"]
DOCKERFILE

# Dockerfile.tajcoin public — binaire depuis release Taj-Coin (pas de source locale)
cat > "${OUT}/core/docker/Dockerfile.tajcoin" << 'DOCKERFILE'
FROM ubuntu:20.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TAJCOIN_DATADIR=/data/tajcoin

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    unzip \
    wget \
    libboost-chrono1.71.0 \
    libboost-filesystem1.71.0 \
    libboost-program-options1.71.0 \
    libboost-thread1.71.0 \
    libdb5.3++ \
    libssl1.1 \
    && rm -rf /var/lib/apt/lists/*

ARG TAJCOIND_URL=https://github.com/Taj-Coin/tajcoin/releases/download/v1.1/tajcoind-20.04-v1.1.zip
RUN wget -qO /tmp/tajcoind.zip "${TAJCOIND_URL}" \
    && unzip -jo /tmp/tajcoind.zip tajcoind -d /usr/local/bin/ \
    && chmod +x /usr/local/bin/tajcoind \
    && rm /tmp/tajcoind.zip

COPY Tajcoin/tajcoin.docker.conf /etc/tajcoin/tajcoin.docker.conf
COPY scripts/tajcoind-entrypoint.sh /usr/local/bin/tajcoind-entrypoint.sh
RUN chmod +x /usr/local/bin/tajcoind-entrypoint.sh

EXPOSE 10712 12107

ENTRYPOINT ["tajcoind-entrypoint.sh"]
DOCKERFILE

# Copy verify script reference
cp "${ROOT}/scripts/verify-public-release.sh" "${OUT}/scripts/verify-public-release.sh"
chmod +x "${OUT}/scripts/verify-public-release.sh" "${OUT}/scripts/"*.sh 2>/dev/null || true

echo ""
echo "=== Vérification intégrité ==="
"${OUT}/scripts/verify-public-release.sh" "${OUT}" || true

echo ""
echo "✅ Arbre public prêt : ${OUT}"
echo "   Prochaine étape : cd ${OUT} && git init && git add . && git commit"
echo "   Puis rendre le dépôt GitHub public."
