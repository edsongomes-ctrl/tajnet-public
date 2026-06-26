#!/bin/sh
# Tajcoin tajcoind — entrée conteneur TajNet
# Inspiré du Dockerfile racine (Ubuntu + tajcoind), avec assets locaux Tajcoin/
set -e

DATADIR="${TAJCOIN_DATADIR:-/data/tajcoin}"
CONF="${TAJCOIN_CONF:-/etc/tajcoin/tajcoin.docker.conf}"
BOOTSTRAP_ZIP="${TAJCOIN_BOOTSTRAP:-/bootstrap/bootstrap-900600.zip}"
RPC_USER="${TAJCOIN_RPC_USER:-tajnet}"
RPC_PASS="${TAJCOIN_RPC_PASSWORD:-changeme}"

mkdir -p "$DATADIR"

# Conf runtime (rpcuser/rpcpassword injectés)
RUNTIME_CONF="$DATADIR/tajcoin.conf"
if [ ! -f "$RUNTIME_CONF" ]; then
  echo "📝 Génération $RUNTIME_CONF"
  cp "$CONF" "$RUNTIME_CONF"
  echo "rpcuser=$RPC_USER" >> "$RUNTIME_CONF"
  echo "rpcpassword=$RPC_PASS" >> "$RUNTIME_CONF"
fi

# Bootstrap blockchain (bootstrap-900600.zip → blk*.dat, database/, txleveldb/)
if [ ! -f "$DATADIR/.bootstrap_done" ] && [ -f "$BOOTSTRAP_ZIP" ]; then
  echo "⛓️  Import bootstrap Tajcoin depuis $(basename "$BOOTSTRAP_ZIP")..."
  unzip -o "$BOOTSTRAP_ZIP" -d "$DATADIR"
  touch "$DATADIR/.bootstrap_done"
  echo "✅ Bootstrap extrait dans $DATADIR"
elif [ ! -f "$DATADIR/.bootstrap_done" ]; then
  echo "⚠️  Pas de bootstrap trouvé ($BOOTSTRAP_ZIP) — sync P2P depuis le genesis"
fi

echo "🪙 Démarrage tajcoind (P2P 10712, RPC 12107)..."
exec tajcoind -datadir="$DATADIR" -conf="$RUNTIME_CONF" -printtoconsole
