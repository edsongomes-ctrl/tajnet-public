# Tajcoin — intégration Docker TajNet

## Assets locaux

| Fichier / dossier | Rôle |
|-------------------|------|
| `source/tajcoin-master/` | Sources + binaire `src/tajcoind` (build local) |
| `bootstrap-900600.zip` | Snapshot blockchain (~530 Mo) — [téléchargement officiel](https://github.com/Taj-Coin/tajcoin/releases/download/v1.1/bootstrap-900600.zip) |
| `data/` | Datadir persistant (`wallet.dat`, blocs, conf runtime) |
| `tajcoin.conf` | Addnodes réseau live |
| `tajcoin.docker.conf` | Template Docker (RPC, ports) |

## Modes de déploiement

| Mode | Core TajNet | Tajcoin | RPC vu par le core |
|------|-------------|---------|-------------------|
| **Hôte** (défaut) | `network_mode: host` | `tajcoind` sur la machine | `http://127.0.0.1:12107` |
| **Embarqué** | réseau bridge + override | conteneur `taj-tajcoin` | `http://tajcoin:12107` |
| **Docker externe** | `network_mode: host` | votre conteneur, port `-p 12107:12107` | `http://127.0.0.1:12107` |

Documentation utilisateur complète : [`README.md`](../README.md) — section *Déploiement Docker*.

## Bootstrap blockchain (premier démarrage)

Le snapshot **n'est pas** inclus dans le dépôt TajNet. Téléchargement depuis le compte officiel **Taj-Coin** :

```bash
./scripts/fetch-bootstrap.sh
```

URL directe :

```text
https://github.com/Taj-Coin/tajcoin/releases/download/v1.1/bootstrap-900600.zip
```

Le fichier doit se trouver dans `Tajcoin/bootstrap-900600.zip` avant le premier lancement du profil `embedded-tajcoin`. Sans bootstrap, `tajcoind` synchronise via P2P (plus long).

Variable optionnelle : `TAJCOIN_BOOTSTRAP_URL` pour un miroir alternatif.

## Mode hôte — tajcoind déjà lancé

Si vous avez déjà `tajcoind` sur la machine (ports 10712 / 12107), **ne lancez pas** le service Docker `tajcoin` :

```bash
docker compose up -d --build
```

Le core est en `network_mode: host` et contacte le nœud via **`http://127.0.0.1:12107`** (variable `TAJCOIN_RPC_URL`).

Assurez-vous que votre `tajcoin.conf` contient :

```ini
server=1
rpcuser=tajnet
rpcpassword=changeme
rpcallowip=127.0.0.1
rpcallowip=172.16.0.0/12
```

Les identifiants RPC doivent correspondre à `.env` (`TAJCOIN_RPC_USER` / `TAJCOIN_RPC_PASSWORD`).

## Mode embarqué — sans tajcoind sur l'hôte

Recommandé sur un VPS sans daemons préinstallés :

```bash
docker compose -f docker-compose.yml -f docker-compose.embedded.yml \
  --profile embedded-ipfs --profile embedded-tajcoin up -d --build
```

- Le conteneur `taj-tajcoin` utilise `Tajcoin/data/` et le bootstrap local.
- Aucun port Tajcoin n'est publié sur l'hôte (pas de conflit avec un daemon existant).
- Le core joint Tajcoin via le réseau Docker interne (`http://tajcoin:12107`).
- Le panel reste accessible sur **http://localhost:8090/panel/** (page d'accueil : `/`).

Dans `.env` :

```env
TAJCOIN_RPC_USER=tajnet
TAJCOIN_RPC_PASSWORD=changeme
```

## Tajcoin en conteneur séparé (votre image)

Si vous utilisez **votre propre** image Docker Tajcoin (hors stack TajNet) :

```bash
docker run -d --name tajcoin \
  -p 12107:12107 \
  -v /opt/tajcoin/data:/data/tajcoin \
  votre-image-tajcoin
```

Puis TajNet **sans** profil `embedded-tajcoin` :

```bash
docker compose up -d --build
```

Dans `.env` :

```env
TAJCOIN_HOST_DATADIR=/opt/tajcoin/data
TAJCOIN_RPC_URL=http://127.0.0.1:12107
TAJCOIN_RPC_USER=tajnet
TAJCOIN_RPC_PASSWORD=changeme
```

> Ne lancez pas un `tajcoind` sur l'hôte **et** un conteneur Tajcoin en parallèle (conflit de ports / datadir).

## Service Docker embarqué (référence)

Image : `core/docker/Dockerfile.tajcoin` (Ubuntu 24).

```bash
docker compose --profile embedded-tajcoin up -d --build tajcoin
```

Au premier démarrage, le bootstrap est extrait dans `Tajcoin/data/`. Le wallet est créé automatiquement par `tajcoind` si absent.

## RPC (Guard, paiements, annonces)

Variables dans `.env` :

```
TAJCOIN_RPC_USER=tajnet
TAJCOIN_RPC_PASSWORD=changeme
```

En mode embarqué, le core contacte `http://tajcoin:12107`.  
En mode hôte ou Docker externe, utilisez `http://127.0.0.1:12107`.

Les comptes wallet (`tajpanel`, `tajannounce`, etc.) doivent exister **dans le wallet du nœud Tajcoin** utilisé par le core.
