# Première installation — TajNet Graine

Guide rapide pour un premier déploiement. Documentation complète : [`README.md`](README.md).

## 1. Prérequis

- Linux, Docker & Docker Compose
- IPFS Kubo et Tajcoin (`tajcoind`) **ou** profil Docker embarqué

## 2. Configuration

```bash
cp .env.example .env
nano .env
```

Variables essentielles :

| Variable | Usage |
|----------|-------|
| `TAJCOIN_HOST_DATADIR` | Dossier `wallet.dat` Tajcoin sur l'hôte |
| `PANEL_PORT` | Port HTTP du panel (défaut `8090`) |
| `TAJNODE_MODE=vps` | Nœud public sur Internet (panel WAN + MetaMask) |
| `TRUST_PROXY=1` | Derrière Nginx/Caddy (IP client réelle) |

## 3. Démarrage

**Binaires Tajcoin** (sans téléchargement GitHub) : dossier `applications/` — voir `./scripts/list-tajcoin-apps.sh`.

**Daemons sur l'hôte :**

```bash
docker compose up -d --build
```

**Tout en Docker (VPS vierge) :**

```bash
./scripts/fetch-bootstrap.sh   # blockchain uniquement — Taj-Coin/tajcoin sur GitHub
./scripts/list-tajcoin-apps.sh # tajcoind / Qt déjà dans applications/
docker compose -f docker-compose.yml -f docker-compose.embedded.yml \
  --profile embedded-ipfs --profile embedded-tajcoin up -d --build
```

Bootstrap officiel (~530 Mo) : [Taj-Coin/tajcoin v1.1](https://github.com/Taj-Coin/tajcoin/releases/download/v1.1/bootstrap-900600.zip) — **pas** dans `applications/`, via `./scripts/fetch-bootstrap.sh`.

**VPS avec tajcoind déjà installé** (conteneur existant) :

```bash
# Depuis votre PC — fichier credentials local (user, pass, ip), ne pas committer
./scripts/deploy-vps.sh ./credentials.env
./scripts/enable-vps-domain.sh ./credentials.env tajnet.cloud admin@tajnet.cloud
```

Voir le README — [FAQ déploiement VPS](README.md#déploiement-vps--difficultés-rencontrées-retour-dexpérience) pour les pièges courants (RPC 403, certificat auto-signé, etc.).

### Nœud public (VPS)

Dans `.env` :

```env
TAJNODE_MODE=vps
TRUST_PROXY=1
```

- **`/`** — page d'accueil publique (personnalisable depuis le panel en localhost)
- **`/panel/`** — accessible sur Internet ; MetaMask requis pour payer/envoyer
- **Matomo** — reste bloqué sur Internet (tunnel SSH ou localhost)
- **HTTPS sans domaine** — certificat auto-signé sur l'IP ; uploads et POST WAN peuvent afficher `Failed to fetch` → voir [README — Sans nom de domaine](README.md#sans-nom-de-domaine-accès-par-ip-seule)

## 4. Accès web

| URL | Rôle |
|-----|------|
| https://tajnet.cloud/ | **Nœud public de référence** — doc + statut live |
| https://tajnet.cloud/panel/ | TajPanel production |
| http://localhost:8090/ | Page d'accueil — développement local |
| http://localhost:8090/panel/ | **TajPanel** — tableau de bord local |
| https://localhost:8443/ | Panel HTTPS local (dev) |

> **Production** : [tajnet.cloud](https://tajnet.cloud/) (Let's Encrypt). **Sans domaine** : certificat auto-signé sur l'IP — voir [README — Sans nom de domaine](README.md#sans-nom-de-domaine-accès-par-ip-seule).

**Administration distante (recommandé) :**

```bash
ssh -L 8090:127.0.0.1:8090 user@serveur
```

Puis http://localhost:8090/panel/ — accès opérateur complet (wallet.dat, landing).

## 5. Premier pas dans le panel

1. Vérifier IPFS et Tajcoin (voyants verts)
2. **Sécurité → Guard** — payer 1 TAJ pour débloquer les envois
3. **Wallet** — connecter MetaMask ou alimenter le compte `tajpanel`
4. *(localhost)* **Administration opérateur** — personnaliser la page d'accueil, sauvegarder `wallet.dat`

## 6. HTTPS (optionnel)

```bash
./scripts/generate-tls-cert.sh
```

```env
TLS_ENABLED=true
TLS_PORT=8443
TLS_HTTP_REDIRECT=true
```

Voir le [README — HTTPS](README.md#https-certificat-auto-signé).
