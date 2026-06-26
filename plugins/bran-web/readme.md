# Bran Web — Système de lecture modulaire

Interface web légère : biographie + chronique Markdown, thème archive Venardi / Weirwood.

## Intégration TajNet

| Parcours | URL | Description |
|----------|-----|-------------|
| **Éditeur client** | `/bran-web/edit.html` | Sections Markdown (bio.md, source.md, + custom), aperçu gratuit, brouillon `localStorage` |
| **Publication IPFS** | bouton éditeur | 2 TAJ + MetaMask → `POST /api/bran-web/publish/*` |
| **Archive démo nœud** | `/bran-web/` | Générée par l'opérateur depuis `workflow-bran.md` |

L'éditeur client **n'utilise pas** l'API workflow — il charge `bio.md` / `source.md` comme modèles statiques au premier affichage.

## Workflow opérateur (archive démo)

**Un seul fichier source** : `workflow-bran.md` à la racine du projet.

```bash
# 1. Éditer workflow-bran.md (frontmatter YAML + sections @bio et @source)
# 2. Générer la structure
python3 generate-bran.py

# 3. Lancer le serveur local
python3 -m http.server 8000
# → http://localhost:8000
```

Validation sans écriture :

```bash
python3 generate-bran.py --check
```

### Génération par IA (Cursor)

Le skill `.cursor/skills/bran-web/SKILL.md` indique à l'agent comment lire `workflow-bran.md` et produire la structure complète. Commande type :

> « Génère la structure Bran Web depuis workflow-bran.md »

## Arborescence

```text
/
├── workflow-bran.md    # Source de vérité (YAML + @bio + @source)
├── generate-bran.py    # Générateur Python (stdlib only)
├── index.html          # Squelette généré
├── style.css           # Thème CSS (statique)
├── script.js           # Fetch bio.md + source.md + images (statique)
├── bio.md              # Généré depuis ## @bio
├── source.md           # Généré depuis ## @source
├── image/
│   ├── photo1up.*      # En-tête (auto-détecté)
│   └── photo2down.*    # Pied de page (optionnel)
├── _scaffold/          # Bootstrap pour nouveaux projets
└── templates/          # Archives HTML standalone (référence)
```

## Format workflow-bran.md

```markdown
---
title: "Mon Archive | Sujet"
theme: theme-enfants-foret
nav_logo: BRAN
nav_logo_accent: WOOD
image_header_copy_from: chemin/photo.jpg
image_header_alt: "Description accessible"
---

## @bio
(contenu markdown → bio.md)

## @source
(contenu markdown → source.md)
```

Voir `workflow-bran.md` pour l'exemple complet Brandon Stark.

## Fonctionnement technique

- **Chargement** : `script.js` fetch en parallèle `bio.md` + `source.md` via `Promise.all`.
- **Markdown** : `marked.js` (CDN) parse le contenu dans `#bio-container` et `#article-container`.
- **Images** : détection automatique de `image/photo1up.*` et `image/photo2down.*` (HEAD request).
- **Config page** : attributs `data-*` sur `<body>` injectés par le générateur (`headerAlt`, `consoleLog`, etc.).

## Nouveau projet

1. Créer un dossier vide.
2. Copier `generate-bran.py`, `_scaffold/` et adapter `workflow-bran.md`.
3. `python3 generate-bran.py`
4. Serveur HTTP depuis la racine (pas `file://`, pas `templates/`).

## Personnalisation

- **Design** : variables CSS dans `style.css` (`--forest-*`, `--leaf-glow`, etc.).
- **Contenu** : modifier `workflow-bran.md` puis relancer `generate-bran.py`.
- **Thème body** : `theme-enfants-foret` (Weirwood × Futuremen).
