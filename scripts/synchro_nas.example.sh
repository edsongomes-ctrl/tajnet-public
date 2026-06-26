#!/bin/bash
# Exemple — copiez vers synchro_nas.sh (gitignored) et adaptez les chemins.

LOCAL_DIR="${TAJNET_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}/"
MOUNT_DIR="${NAS_MOUNT_DIR:-/run/user/$(id -u)/gvfs/smb-share:server=nas.local,share=donnees}"
TARGET_DIR="${MOUNT_DIR}/tajnet/"

echo "Sync TajNet <-> NAS"
echo "  Local  : $LOCAL_DIR"
echo "  Cible  : $TARGET_DIR"

command -v unison >/dev/null || { echo "Installez unison : sudo apt install unison"; exit 1; }
[ -d "$MOUNT_DIR" ] || { echo "Montez d'abord votre partage NAS dans $MOUNT_DIR"; exit 1; }

mkdir -p "$TARGET_DIR"
unison "$LOCAL_DIR" "$TARGET_DIR" -batch -ignore 'Name node_modules' -ignore 'Name .git' -ignore 'Name .env' -ignore 'Name data' -ignore 'Name wallet'
