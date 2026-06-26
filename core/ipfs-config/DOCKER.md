# IPFS — intégration Docker TajNet

## Mode hôte (défaut)

Si Kubo/IPFS tourne déjà sur la machine (API **5001**) :

```bash
docker compose up -d --build
```

Le core est en `network_mode: host` et contacte **`http://127.0.0.1:5001`** (`IPFS_API_URL` dans `.env`).

Si le TajPanel affiche IPFS offline, autorisez l'API sur toutes les interfaces :

```bash
ipfs config Addresses.API /ip4/0.0.0.0/tcp/5001
ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/8080
# puis redémarrer ipfs
```

## Mode embarqué

Sans IPFS local :

```bash
docker compose -f docker-compose.yml -f docker-compose.embedded.yml \
  --profile embedded-ipfs up -d --build
```

Avec l'override embarqué, le core utilise `IPFS_API_URL=http://ipfs:5001` sur le réseau Docker.

## Stack 100 % Docker (sans daemons hôte)

```bash
docker compose -f docker-compose.yml -f docker-compose.embedded.yml \
  --profile embedded-ipfs --profile embedded-tajcoin up -d --build
```

Accès web : http://localhost:8090/ (accueil) · http://localhost:8090/panel/ (TajPanel)

Voir aussi [`README.md`](../../README.md) et [`Tajcoin/DOCKER.md`](../../Tajcoin/DOCKER.md).
