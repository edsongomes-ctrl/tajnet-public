# TajNet Plugins

TajNet extends through **plugins** — one folder per extension under `plugins/`.

## Structure

```
plugins/my-plugin/
├── manifest.json   # name, version, description, active
├── index.js        # optional — Node handlers exported to the core
└── …               # static assets, templates, uploads/
```

## manifest.json

```json
{
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Short description",
  "active": true
}
```

## Loader

The core (`core/lib/plugins.js`) scans `plugins/` at startup:

- `GET /api/status` → active plugin IDs
- `GET /api/plugins` → full manifest list
- `loadPluginHandler(pluginsDir, id)` → `require(plugins/<id>/index.js)`

Dedicated API routes (e.g. `/api/bran-web/*`) are registered in `core/bridge.js` when a plugin needs HTTP endpoints beyond the generic loader.

## Included in this public edition: **Bran Web**

| Path | Role |
|------|------|
| `/bran-web/` | Demo archive (operator workflow) |
| `/bran-web/edit.html` | Client editor (bio.md, source.md sections) |
| `/api/bran-web/*` | Workflow, generate, publish to IPFS |

Publish flow: **2 TAJ** + MetaMask via `POST /api/bran-web/publish/*`.

See `plugins/bran-web/readme.md` for details.

## Building your own plugin

1. Copy `plugins/bran-web/manifest.json` as a template.
2. Add `index.js` exporting functions the core can call (optional).
3. Request a route in `core/bridge.js` or use existing generic APIs (IPFS upload, Discover announce).
4. Set `"active": true` and restart `taj-core`.

## Full operator edition

The private / full TajNet tree may also ship **Super CV** (semantic CV index), **Matomo** (local analytics), and **Futuremen** (live Discover chronicle). They are not part of this public repository — only **Bran Web** is bundled here.
