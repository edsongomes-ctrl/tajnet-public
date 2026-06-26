#!/usr/bin/env bash
# Résout un identifiant ou chemin vers un fichier credentials nœud.
# Usage : source scripts/lib/node-env.sh && resolve_node_env raspberry
resolve_node_env() {
  local arg="${1:-}"
  local root="${2:-}"

  if [ -z "$arg" ]; then
    return 1
  fi

  if [ -z "$root" ]; then
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  fi

  if [ -f "$arg" ]; then
    printf '%s\n' "$arg"
    return 0
  fi

  local base="${arg%.env}"
  local candidate
  for candidate in \
    "${root}/secrets/nodes/${base}.env" \
    "${root}/secrets/nodes/${arg}" \
    "${root}/${base}.env" \
    "${root}/${arg}" \
    "${root}/lastfmnode.env"; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if [ "$base" = "lastfm" ] && [ -f "${root}/secrets/nodes/lastfmnode.env" ]; then
    printf '%s\n' "${root}/secrets/nodes/lastfmnode.env"
    return 0
  fi

  return 1
}

load_node_env() {
  local arg="${1:-}"
  local root="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
  local resolved

  resolved="$(resolve_node_env "$arg" "$root")" || return 1
  printf '%s\n' "$resolved"
}
