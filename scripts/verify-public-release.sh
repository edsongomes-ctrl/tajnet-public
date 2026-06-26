#!/usr/bin/env bash
# Scan a TajNet tree for secrets / private paths before public GitHub publish.
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
FAIL=0

warn() { echo "  ⚠️  $*"; FAIL=1; }
ok() { echo "  ✓ $*"; }

echo "🔍 Vérification release publique : ${ROOT}"

# Forbidden files
FORBIDDEN_FILES=(
  .env
  GitHub.txt
  credentials.env
  saopaulo.env
  raspberry.env
  synchro_nas.sh
)
for f in "${FORBIDDEN_FILES[@]}"; do
  if [ -f "${ROOT}/${f}" ]; then
    warn "Fichier interdit présent : ${f}"
  else
    ok "Absent : ${f}"
  fi
done

# Forbidden dirs with content
for d in data/matomo data/matomo_db data/super-cv brain fixtures plugins/super-cv panel/cv panel/futuremen; do
  if [ -d "${ROOT}/${d}" ] && [ "$(find "${ROOT}/${d}" -mindepth 1 ! -name '.gitkeep' 2>/dev/null | head -1)" ]; then
    warn "Données sensibles dans ${d}/"
  else
    ok "Vide ou absent : ${d}/"
  fi
done

# Secret patterns in tracked-like files
if grep -rEil '(password|secret|token|api_key)\s*=\s*[^$\{][^#\s]{8,}' "${ROOT}" \
  --include='*.env' --include='*.json' --include='*.sh' 2>/dev/null | grep -v '.env.example' | head -5; then
  warn "Motifs secret trouvés (voir ci-dessus)"
else
  ok "Pas de secrets évidents dans .env/.json"
fi

# Edition flag
if [ -f "${ROOT}/.env.example" ] && grep -q 'TAJNET_EDITION=public' "${ROOT}/.env.example"; then
  ok "TAJNET_EDITION=public dans .env.example"
else
  warn "TAJNET_EDITION=public manquant dans .env.example"
fi

# Bran Web only
if [ -d "${ROOT}/plugins/super-cv" ]; then
  warn "plugins/super-cv/ encore présent"
else
  ok "plugins/super-cv/ absent"
fi
if [ -d "${ROOT}/plugins/bran-web/manifest.json" ] || [ -f "${ROOT}/plugins/bran-web/manifest.json" ]; then
  ok "plugins/bran-web/ présent"
else
  warn "plugins/bran-web/ manquant"
fi

# i18n
if [ -f "${ROOT}/panel/shared/i18n.js" ] && [ -f "${ROOT}/panel/shared/locales/sw.json" ]; then
  ok "i18n (9 langues) présent"
else
  warn "Fichiers i18n incomplets"
fi

if [ -f "${ROOT}/panel/wallet/index.html" ]; then
  ok "panel/wallet/ présent"
else
  warn "panel/wallet/ manquant"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "✅ Release publique OK"
  exit 0
fi
echo "❌ Problèmes détectés — corrigez avant publication GitHub"
exit 1
