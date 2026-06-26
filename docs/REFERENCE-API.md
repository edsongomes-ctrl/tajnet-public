# Référence API — TajNet Graine v0.1

Nœud public de référence : **https://tajnet.cloud** · contact **info@tajnet.cloud**

Documentation technique pour développeurs et intégrateurs.  
Pour le guide utilisateur, voir le [README](../README.md).

Base URL par défaut : `http://localhost:8090` (HTTP) ou `https://localhost:8443` (HTTPS si `TLS_ENABLED=true`)

| Interface | Chemin |
|-----------|--------|
| Page d'accueil | `/` |
| TajPanel | `/panel/` |
| Éditeur | `/editor` |
| Futuremen | `/futuremen/` |
| Fiche contenu | `/view/?txid=…` |
| Fiche candidat (Super CV) | `/cv/?id=…` ou `/cv/?txid=…` |
| Archive Bran Web (démo) | `/bran-web/` |
| Éditeur Bran Web | `/bran-web/edit.html` |
| Wallet | `/wallet/` |
| Proxy Matomo | `/matomo/` |
| API REST | `/api/…` |

---

## Système

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/status` | Moteur, IPFS, Tajcoin, Matomo, guard, discover, plugins, sécurité réseau |
| GET | `/api/plugins` | Liste des plugins |

### Champs notables de `GET /api/status`

| Champ | Type | Description |
|-------|------|-------------|
| `requestZone` | `"localhost"` \| `"lan"` \| `"wan"` | Zone réseau du client (IP, pas Host) |
| `localWalletAllowed` | boolean | Wallet nœud autorisé pour cette requête |
| `localWalletLanOpen` | boolean | `WALLET_LOCAL_LAN=true` actif |
| `wanPanelAccess` | boolean | `WAN_PANEL_ACCESS=true` actif |
| `publicPanel` | boolean | `TAJNODE_MODE=vps` ou `PUBLIC_PANEL=true` |
| `tajnodeMode` | `"local"` \| `"vps"` | Mode de déploiement |
| `landing` | object | Profil page d'accueil (voir Landing) |
| `walletDat` | object | Statut `wallet.dat` (localhost) ou `{ restricted: true }` |
| `tajcoinConf` | object | Addnodes `tajcoin.conf` (localhost) ou `{ restricted: true }` |
| `tls` | object | État HTTPS (`enabled`, `port`, `fingerprintSha256`, …) |
| `superCv` | object | Compteurs index local + Discover |
| `cvAccess` | object | Service consultation recruteur (`price`, `grantCount`, …) |
| `matomo` | object | État Matomo — voir [Matomo](#matomo) |

---

## Landing (`/api/landing/…`)

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/profile` | Public | Profil page d'accueil |
| PUT | `/profile` | **localhost** | Met à jour le profil `{ profile: { … } }` |

### Objet `profile`

| Champ | Description |
|-------|-------------|
| `nodeName` | Nom affiché dans la barre de navigation |
| `tagline` | Accroche hero |
| `heroTitle` | Titre principal (`\n` pour saut de ligne) |
| `heroLead` | Paragraphe d'introduction |
| `primaryCtaLabel` / `primaryCtaUrl` | Bouton principal |
| `secondaryCtaLabel` / `secondaryCtaUrl` | Bouton secondaire |
| `footerText` | Pied de page |
| `contactEmail` | Email de contact (affiché en pied de page, ex. `info@tajnet.cloud`) |
| `showDeploymentSection` | Afficher la section Docker (défaut : `true`) |

Persistance : `data/landing/profile.json` (`TAJNET_DATA_DIR`).

---

## Wallet Tajcoin fichier (`/api/tajcoin/wallet/…`)

Opérations sur `wallet.dat` — **localhost uniquement** (403 depuis LAN/WAN).

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/status` | Chemin, taille, date de modification |
| GET | `/export` | Téléchargement binaire `wallet.dat` |
| POST | `/import` | Upload multipart, champ `wallet` |

Réponse import réussie : `{ success, message, path, sizeBytes }`.  
Une sauvegarde `wallet.dat.bak-<timestamp>` est créée avant écrasement.

Chemin résolu : `TAJCOIN_DATA_DIR/wallet.dat` ou `TAJCOIN_WALLET_FILE`.

---

## Peers Tajcoin (`/api/tajcoin/nodes/…`)

Gestion des lignes `addnode=` dans `tajcoin.conf` — **localhost uniquement**.

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Liste `addnode`, chemin conf, peers RPC (`getpeerinfo`) |
| POST | `/` | Ajoute `{ node }` ou `{ nodes: [] }`, option `connectNow` (défaut `true`) |
| DELETE | `/:node` | Retire un addnode ; `?disconnect=1` tente `disconnectnode` RPC |

Validation : IPv4 ou hostname, port optionnel (P2P Tajcoin : **10712**).

Persistance : `TAJCOIN_DATA_DIR/tajcoin.conf` ou `TAJCOIN_CONF_FILE`.

Réponse POST réussie : `{ added, addnodes, rpc: [{ address, connected, error? }] }`.

Champ `GET /api/status` → `tajcoinConf` (localhost) : `{ available, path, count, addnodes }`.

---

## IPFS & publication

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/ipfs/upload` | Upload fichier → CID + gateway (**402** sans Guard) + annonce |
| POST | `/api/publish` | Publie une page HTML GrapesJS (**402** sans Guard) + Matomo + annonce |
| GET | `/api/editor/config` | Config IPFS gateway + Matomo + guard pour l'éditeur |

Header Guard : `X-Guard-Session: <sessionId>`

---

## Paiements unifiés (`/api/payments/…`)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/services` | Catalogue des services payants (guard, pin, comptes à alimenter) |
| GET | `/options` | Solde du compte nœud `tajpanel` |
| POST | `/fund` | Alimente un compte système `{ account, amount?, source? }` |

Comptes alimentables : `tajannounce`, `tajpanel`.

Header wallet optionnel : `X-Wallet-Session: <sessionId>`

---

## Guard Daemon (`/api/guard/…`)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/status` | État global (locked, sessions, prix) |
| GET | `/config` | Tarif et config publique |
| GET | `/pay-options` | Solde local + tarif |
| POST | `/pay` | Paiement intégré `{ sessionId, source? }` |
| POST | `/session` | Crée une session de paiement |
| GET | `/session/:id` | Rafraîchit une session |
| POST | `/check` | Force scan blockchain `{ sessionId }` |
| POST | `/lock` | Verrouille session(s) |

Routes protégées : `POST /api/upload`, `POST /api/ipfs/upload`, `POST /api/publish`.

---

## Pin service (`/api/pin-service/…`)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/status` | Tarif, sessions actives |
| GET | `/pay-options` | Solde local + tarif |
| POST | `/pay` | Paiement intégré `{ sessionId, source? }` |
| POST | `/request` | Créer session `{ contentCid, title?, sourceTxid? }` |
| GET | `/session/:id` | État session |
| POST | `/session/:id/check` | Vérifier paiement + exécuter pin |

---

## Wallet (`/api/wallet/…`)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/rpc/profiles` | Profils RPC disponibles |
| POST | `/rpc/test` | Test connexion RPC |
| POST | `/auth/check-wallet` | Vérifie wallet MetaMask |
| POST | `/auth/create-wallet` | Crée compte `user_{hash}` |
| POST | `/auth/login` | Connexion MetaMask |
| POST | `/auth/logout` | Fin de session |
| GET | `/auth/session` | Session courante |
| GET/POST | `/local` | Wallet nœud `tajpanel` — **localhost** (ou LAN si `WALLET_LOCAL_LAN`) |
| GET | `/data` | Solde, adresses, historique |
| POST | `/new-address` | Nouvelle adresse |
| POST | `/send` | Envoi TAJ |
| POST | `/validate-address` | Validation adresse |

Sessions wallet persistées : `data/wallet/sessions.json`.

---

## Annonces Tajcoin (`/api/announce/…`)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/config` | Config publique |
| GET | `/status` | Compte `tajannounce`, UTXO, solde |

Flux : metadata JSON sur IPFS → transaction OP_RETURN (`TAJ` + type + CID).

---

## Discover (`/api/discover/…`)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/status` | État index |
| POST | `/enable` / `/disable` | Activer / désactiver |
| POST | `/scan` | Force scan blocs + wallet |
| GET | `/entries` | Liste/recherche — entrées `type: cv` : liens IPFS masqués sans paywall recruteur |
| GET | `/entries/:txid` | Détail entrée (même règle CV) |
| POST | `/entries/:txid/pin` | Épingler localement (gratuit) |
| POST | `/entries/:txid/pin-request` | Session pinning payant |
| GET | `/pins` | Pins locaux |
| POST | `/profile` | Profil public du nœud |

### Encodage Unicode (titres & commentaires)

Les entrées Discover proviennent de commentaires wallet Tajcoin, d'OP_RETURN texte ou du format compact `TAJNETv1|TITLE:…`. Le module [`core/lib/text-encoding.js`](../core/lib/text-encoding.js) :

- décode les buffers OP_RETURN en UTF-8 ou Latin-1 (ISO-8859-1) ;
- corrige le mojibake UTF-8 mal interprété (`Ã©` → `é`) ;
- normalise `title`, `tags` et champs metadata à l'indexation et à l'affichage (`GET /entries`, `GET /pins`).

Aucun paramètre API supplémentaire : la correction est appliquée côté serveur.

### Entrées Super CV (`type: cv`)

Les CV publiés sur la blockchain apparaissent dans Discover comme les autres annonces. Le **paywall recruteur** s'applique partout où un lien IPFS pourrait fuiter :

| Surface | Comportement sans paiement |
|---------|----------------------------|
| TajPanel → **Réseau → Discover** | Lien **Fiche candidat** ; pas de **Contenu IPFS ↗** |
| **`/view?txid=…`** | Bandeau consultation recruteur → redirection `/cv` |
| **`/api/discover/entries`** | `contentUrl`, `publicContentUrl` et `contentCid` absents |
| **Futuremen** (`/api/futuremen/feed`) | Pas de `contentUrl` sur CV verrouillés |

Header optionnel pour tester le déblocage : `X-Wallet-Session` (MetaMask). Si le wallet a déjà payé pour ce `profileId`, la réponse inclut les URLs IPFS.

Champs ajoutés sur les entrées CV :

| Champ | Description |
|-------|-------------|
| `cvProfileId` | Identifiant profil (préfixe txid ou id index) |
| `cvHasIpfsContent` | Un fichier CV est référencé |
| `cvContentUnlocked` | Le wallet connecté a payé la consultation |
| `cvFicheUrl` | `/cv?id=…` |
| `cvAccessPrice` | Tarif consultation (défaut 1 TAJ) |

Implémentation : [`core/lib/cv-discover-gate.js`](../core/lib/cv-discover-gate.js) · [`core/lib/cv-access.js`](../core/lib/cv-access.js).

---

## Futuremen (`/api/futuremen/…`)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/feed` | Flux Discover fusionné (nœud local + partenaires + `FUTUREMEN_NODE_URLS`) |

Réponse : `{ success, entries[], sources[], entryCount, publicOrigin, generatedAt, … }` — dédoublonnage par `contentCid`, liens fiche canoniques vers `FUTUREMEN_PUBLIC_ORIGIN` (défaut `https://tajnet.cloud`). Les CV verrouillés n'exposent pas de lien IPFS direct (voir [Entrées Super CV](#entrées-super-cv-type-cv) ci-dessus).

**Page** `/futuremen/` : HTML servi par le core avec **snippet Matomo** injecté (`MATOMO_PUBLIC_URL` ou `{DISCOVER_NODE_ENDPOINT}/matomo/`).

Variables : `FUTUREMEN_NODE_URLS`, `FUTUREMEN_PUBLIC_ORIGIN` (voir [`.env.example`](../.env.example)).

---

## Fiche contenu (`/api/view/…`)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/resolve` | Résout `?txid=` ou `?meta=` (CID métadonnées) → fiche JSON pour `/view/` |

Header optionnel : `X-Wallet-Session` (MetaMask).

Pour les annonces **`type: cv`**, les champs `contentUrl`, `publicContentUrl` et `contentCid` sont masqués tant que le recruteur n'a pas payé (`cvContentUnlocked: false`). La réponse inclut `cvFicheUrl` (`/cv?id=…`) et `cvAccessPrice`.

---

## Super CV (`/api/super-cv/…`)

Index sémantique de profils CV (compétences, recherche). Fusion index **local** + entrées **Discover** de type `cv`.

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/status` | Compteurs index + service consultation recruteur (`cvAccess`) |
| GET | `/skills` | Liste des compétences reconnues par le plugin |
| GET | `/search` | Recherche `?q=&skills=&limit=` — résultats dédoublonnés (`contentCid`, `txid`, `id`) avec `ficheUrl` |
| GET | `/entries` | Tous les profils indexés |
| GET | `/entries/:id` | Profil par id, txid ou préfixe txid |
| GET | `/fiche` | Fiche candidat `?id=` ou `?txid=` — métadonnées publiques ; contenu IPFS si débloqué |

Header wallet optionnel (déblocage recruteur) : `X-Wallet-Session: <sessionId>`

### Consultation recruteur (`/api/super-cv/access/…`)

Paywall TAJ pour consulter le CV complet sur IPFS (fiche `/cv`, Discover, `/view`). Les liens gateway IPFS et le CID contenu sont masqués tant que le recruteur n'a pas payé. Accès persisté par couple `(profileId, adresse wallet recruteur)` dans `data/super-cv/access-grants.json`.

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/request` | Crée une session `{ profileId }` — **MetaMask requis** (`X-Wallet-Session`) |
| GET | `/check/:profileId` | Vérifie si le wallet connecté a débloqué le profil |
| GET | `/pay-options` | Solde local + tarif consultation |
| POST | `/pay` | Paiement intégré `{ sessionId, source? }` |
| GET | `/session/:id` | État session |
| POST | `/session/:id/check` | Scan blockchain + octroi d'accès |

Variables : `CV_ACCESS_PRICE_TAJ` (défaut `1`), `CV_ACCESS_ACCOUNT` (défaut `tajcv`), `CV_ACCESS_ENABLED`, `CV_ACCESS_MIN_CONFIRMATIONS`, `CV_ACCESS_PAYMENT_TIMEOUT_MS`, `CV_ACCESS_POLL_MS`.

Réponse `GET /fiche` (extrait) :

```json
{
  "success": true,
  "fiche": {
    "id": "e58533bfdd933bff",
    "title": "alexandre-renard-demo",
    "skills": ["Docker", "IPFS", "…"],
    "hasIpfsContent": true,
    "contentUnlocked": false,
    "contentCid": null,
    "access": { "enabled": true, "price": 1, "recruiterConnected": false }
  }
}
```

Après paiement : `contentUnlocked: true`, `contentCid`, `contentUrl`, `dwebUrl`.

Le même contrôle d'accès s'applique aux entrées Discover (`GET /api/discover/entries`) et à `GET /api/view/resolve?txid=…` pour les annonces `type: cv`.

### Upload CV (`POST /api/upload`)

Protégé par **Guard** (`X-Guard-Session`). Formats : **PDF**, **TXT**, **JSON**. Le format est détecté depuis le **nom de fichier original** (multer enregistre sans extension côté disque).

Réponse : `{ message, data: { profile, skills, ipfs }, cid, announce, … }`.

Script de test : `node scripts/test-super-cv.js` (local) · `--live` avec `GUARD_SESSION=<id_32_car>` pour upload IPFS + annonce.

---

## Bran Web (`/api/bran-web/…`)

Archives modulaires Venardi — deux usages distincts :

| Usage | Interface | Rôle serveur |
|-------|-----------|--------------|
| **Éditeur client** | `/bran-web/edit.html` | Fichiers statiques uniquement (`bio.md`, `source.md`, `style.css`…) |
| **Archive démo nœud** | `/bran-web/` | Génération depuis `workflow-bran.md` via `generate-bran.py` |

L'image Docker **core** inclut **Python 3** (Alpine) pour la régénération démo (`POST /generate`).

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/status` | Public | État archive démo + tarif publication |
| GET | `/workflow` | Public | Contenu `workflow-bran.md` (exemple opérateur) |
| PUT | `/workflow` | Localhost opérateur | Enregistre `{ workflow: "…" }` (archive démo) |
| POST | `/generate` | Localhost opérateur | Lance `generate-bran.py` (`{ check?: true }`) |
| POST | `/publish/request` | MetaMask | Session publication — body `{ html, title? }` — **2 TAJ** |
| POST | `/publish/pay` | MetaMask | Paiement Tajcoin |
| POST | `/publish/session/:id/check` | Public | Scan paiement → pin IPFS + annonce |
| GET | `/publish/session/:id` | Public | État session |

**Modèle économique (éditeur client)** :

| Action | Coût | MetaMask |
|--------|------|----------|
| Éditeur Markdown (sections bio.md / source.md, + custom) | Gratuit | Non |
| Aperçu live + **Prévisualiser** | Gratuit | Non |
| **Publier IPFS** (HTML standalone + annonce) | **2 TAJ** | Oui |

Brouillon éditeur : `localStorage` clé `branWebEditorDraft` — aucun appel API workflow côté client.

Variables : `BRAN_PUBLISH_PRICE_TAJ` (défaut `2`), `BRAN_PUBLISH_ACCOUNT` (défaut `tajbran`), `BRAN_PUBLISH_ENABLED`.

Champ `GET /api/status` → `branWeb` · publication → `branWeb.publish`.

---

## Pin rewards (`/api/pin-rewards/…`)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/status` | Auto-pay, escrow, compteurs |
| POST | `/claim` | Règlement distant |

---

## Sécurité réseau

Détection par **IP client** (`core/lib/request-local.js`). Derrière reverse proxy : `TRUST_PROXY=1`.

| Variable | Effet |
|----------|-------|
| `TAJNODE_MODE=vps` | Panel / éditeur / wallet UI accessibles sur WAN ; MetaMask requis pour opérations sensibles |
| `PUBLIC_PANEL=true` | Alias de `TAJNODE_MODE=vps` |
| `WAN_PANEL_ACCESS=true` | Panel ouvert sur WAN — Matomo reste localhost/LAN uniquement |
| `WALLET_LOCAL_LAN=true` | Wallet nœud depuis LAN (dev ; jamais WAN) |

Routes UI bloquées sur WAN sans VPS : `/panel/`, `/editor`, `/wallet/` → **403**.

Matomo sur WAN :

| Chemin | WAN |
|--------|-----|
| `/matomo/matomo.js`, `/matomo/matomo.php`, assets tracker | **Autorisé** (pages IPFS, Futuremen) |
| `/matomo/` (admin, iframe dashboard) | **403** — localhost/LAN ou tunnel SSH |

Middleware : `rejectWanPanelUi` + route `/matomo` dans `core/bridge.js` · détection : `isMatomoPublicTrackingPath()` dans `core/lib/request-local.js`.

---

## Matomo

| Variable | Description |
|----------|-------------|
| `MATOMO_URL` | URL interne Docker (défaut `http://127.0.0.1:8888`) |
| `MATOMO_HOST_PORT` | Port localhost du conteneur Matomo (VPS : souvent **8877** ; enregistré dans `.env`, conservé entre deploys) |
| `MATOMO_PUBLIC_URL` | URL publique du tracker (ex. `https://tajnet.cloud/matomo`) — snippet pages IPFS |
| `MATOMO_SITE_ID` | Identifiant site Matomo (défaut `1`) |
| `MATOMO_TRUSTED_HOSTS` | Hôtes supplémentaires pour `trusted_hosts` (domaine VPS) |
| `DISCOVER_NODE_ENDPOINT` | Repli : `{endpoint}/matomo/` si `MATOMO_PUBLIC_URL` absent |

- **Proxy panel** : `/matomo/` → reverse proxy vers `MATOMO_URL`
- **Tracking WAN** : `matomo.js` / `matomo.php` autorisés sur Internet ; admin bloqué
- **Sync `trusted_hosts`** au démarrage : `core/lib/matomo-trusted-hosts.js`
- **Deploy VPS** : `scripts/deploy-vps.sh` met à jour `matomo_site.main_url` en base et **conserve** `MATOMO_HOST_PORT` déjà configuré
- **Tunnel admin** : vérifier `grep MATOMO_HOST_PORT /opt/tajnet/.env` — le port tunnel SSH doit correspondre (8877, 8889, …)

### Objet `matomo` dans `GET /api/status`

| Champ | Description |
|-------|-------------|
| `online` | Matomo joignable (test interne depuis le core) |
| `allowed` | Admin autorisé pour la zone client (`false` sur WAN) |
| `restricted` | Alias inverse de `allowed` sur WAN |
| `tracking` | Tracking actif (`MATOMO_SITE_ID` + Matomo online) |
| `trackingUrl` | Base publique du tracker (ex. `https://tajnet.cloud/matomo/`) |
| `trackingSnippet` | Snippet HTML prêt à copier — **utiliser celui-ci**, pas l'admin Matomo tunnel |
| `siteId` | ID site Matomo |
| `publicUrl` | `MATOMO_PUBLIC_URL` ou repli |
| `dashboardUrl` / `embedUrl` | URLs admin (localhost/LAN uniquement) |

Pages avec injection automatique : **publish** (`POST /api/publish`), **Futuremen** (`/futuremen/`), **Bran Web** (publish IPFS).

---

## HTTPS / TLS

| Variable | Description |
|----------|-------------|
| `TLS_ENABLED` | Active le serveur HTTPS |
| `TLS_PORT` | Port HTTPS (défaut `8443`) |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | Chemins certificat/clé |
| `TLS_HTTP_REDIRECT` | Redirige HTTP → HTTPS |
| `TLS_SAN` | Subject Alternative Names (domaines, IP) |

Génération : `./scripts/generate-tls-cert.sh`  
VPS : `./scripts/enable-vps-tls.sh`  
Empreinte : `GET /api/status` → `tls.fingerprintSha256`

Sur VPS, port **443** recommandé (`TLS_PORT=443`). Certificat auto-signé = avertissement navigateur sans nom de domaine ; Let's Encrypt requis pour un cadenas vert.

### Accès WAN sans nom de domaine

Tant que le TajNode n'a **que l'IP publique** (pas de DNS), le certificat reste **auto-signé** (`./scripts/generate-tls-cert.sh` avec `TLS_SAN=IP:…`).

| Effet | Détail |
|-------|--------|
| Avertissement navigateur | Normal — empreinte dans `GET /api/status` → `tls.fingerprintSha256` |
| Upload / publish depuis Internet | Peut échouer avec **`Failed to fetch`** si le certificat n'est pas accepté ou si l'URL est `http://IP:8090` au lieu de **`https://IP/panel/`** |
| Contournement admin | Tunnel SSH : `ssh -L 8090:127.0.0.1:8090 user@serveur` puis `http://localhost:8090/panel/` |
| Production | Nom de domaine → `TLS_SAN=DNS:mon.domaine,…` + Let's Encrypt (Certbot/Caddy) |

Voir aussi [README — Sans nom de domaine](../README.md#sans-nom-de-domaine-accès-par-ip-seule).

---

## Variables d'environnement

Voir [`.env.example`](../.env.example) et la section « Nœud public (VPS) » du README.

---

## Documentation projet

| Document | Contenu |
|----------|---------|
| [`README.md`](../README.md) | Guide utilisateur (VPS, landing, wallet.dat, HTTPS) |
| [`scripts/fetch-bootstrap.sh`](../scripts/fetch-bootstrap.sh) | Téléchargement `bootstrap-900600.zip` (Taj-Coin) |
| [`scripts/enable-vps-domain.sh`](../scripts/enable-vps-domain.sh) | Nginx + Let's Encrypt (domaine public) |
| [`scripts/generate-tls-cert.sh`](../scripts/generate-tls-cert.sh) | Certificat TLS auto-signé |
| [`brain/tajnet.md`](../brain/tajnet.md) | Mémoire centrale du projet |
| [`brain/AGENTS.md`](../brain/AGENTS.md) | Agents Cursor |
| [`Tajcoin/DOCKER.md`](../Tajcoin/DOCKER.md) | Tajcoin en Docker |
