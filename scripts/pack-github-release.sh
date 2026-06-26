#!/usr/bin/env bash
# Archive TajNet Graine — sans données personnelles, prête pour GitHub / premier usage.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-$(date +%Y%m%d)}"
NAME="tajnet-graine-${VERSION}"
OUT="${ROOT}/dist"
STAGE="${OUT}/${NAME}"
ARCHIVE="${OUT}/${NAME}.tar.gz"

echo "📦 TajNet — packaging ${NAME}"

rm -rf "$STAGE"
mkdir -p "$OUT" "$STAGE"

RSYNC_EXCLUDES=(
  --exclude '.git/'
  --exclude '.cursor/'
  --exclude '.env'
  --exclude 'dist/'
  --exclude 'node_modules/'
  --exclude 'core/node_modules/'
  --exclude 'synchro_nas.sh'
  --exclude 'Editeur GrapeJS/'
  --exclude 'Tajcoin/bootstrap-900600.zip'
  --exclude 'applications/**/*.torrent'
  --exclude 'applications/**/*unstripped*'
  --exclude 'Tajcoin/tajcoin-master.zip'
  --exclude 'Tajcoin/*.deb'
  --exclude 'Tajcoin/source/'
  --exclude 'Tajcoin/data/*'
  --exclude 'data/matomo/'
  --exclude 'data/matomo_db/'
  --exclude 'data/discover/'
  --exclude 'data/super-cv/'
  --exclude 'data/ipfs/'
  --exclude 'data/ipfs_uploads/'
  --exclude 'wallet/*'
  --exclude 'plugins/super-cv/uploads/*'
  --exclude '*.tar.gz'
  --exclude '*.tar'
)

rsync -a "${RSYNC_EXCLUDES[@]}" "${ROOT}/" "${STAGE}/"

# Arborescence vide pour volumes Docker (premier démarrage)
mkdir -p "${STAGE}/data"/{discover,ipfs,ipfs_uploads,super-cv,matomo,matomo_db}
mkdir -p "${STAGE}/Tajcoin/data" "${STAGE}/wallet" "${STAGE}/plugins/super-cv/uploads"
touch "${STAGE}/data/.gitkeep" "${STAGE}/Tajcoin/data/.gitkeep" "${STAGE}/wallet/.gitkeep"
touch "${STAGE}/plugins/super-cv/uploads/.gitkeep"

# Fichiers sensibles / personnels — valeurs génériques
for f in .env.example docker-compose.yml; do
  [ -f "${STAGE}/${f}" ] && sed -i 's|/home/edson|/home/USER|g' "${STAGE}/${f}"
done

# Fichier d'accueil pour nouvel utilisateur
cat > "${STAGE}/PREMIERE-INSTALLATION.md" <<'EOF'
# Première installation — TajNet Graine

Archive prête à l'emploi, sans données personnelles ni secrets.

## 1. Prérequis

- Linux, Docker & Docker Compose
- IPFS Kubo et Tajcoin (`tajcoind`) **ou** profil Docker embarqué (voir README)

## 2. Configuration

```bash
cp .env.example .env
nano .env   # adapter TAJCOIN_HOST_DATADIR ou RPC user/password
```

## 3. Démarrage

**Daemons sur l'hôte :**

```bash
docker compose up -d --build
```

**Tout en Docker (VPS vierge) :**

```bash
./scripts/fetch-bootstrap.sh
docker compose -f docker-compose.yml -f docker-compose.embedded.yml \
  --profile embedded-ipfs --profile embedded-tajcoin up -d --build
```

Bootstrap : https://github.com/Taj-Coin/tajcoin/releases/download/v1.1/bootstrap-900600.zip

## 4. Accès web

| URL | Rôle |
|-----|------|
| http://localhost:8090/ | Page d'accueil — présentation |
| http://localhost:8090/panel/ | **TajPanel** — tableau de bord |

Accès distant : `ssh -L 8090:127.0.0.1:8090 user@serveur`

## 5. Suite

Lisez **README.md** pour Guard, paiements intégrés, Discover et Super CV.

---

*Archive générée par `scripts/pack-github-release.sh` — ne contient pas `.env`, wallets, Matomo installé, ni node_modules.*
EOF

tar -czf "${ARCHIVE}" -C "${OUT}" "${NAME}"

HUMAN=$(du -h "${ARCHIVE}" | cut -f1)
FILE_COUNT=$(tar -tzf "${ARCHIVE}" | wc -l)

echo "✅ Archive : ${ARCHIVE} (${HUMAN}, ${FILE_COUNT} fichiers)"
echo "   Décompresser : tar -xzf ${NAME}.tar.gz"
