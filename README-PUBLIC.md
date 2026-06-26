# TajNet — Public Edition v1.0

**TajNet is born.** A sovereign personal node: IPFS, Tajcoin (TAJ), Guard, Discover, and plugins.

This is the **official public release**. It ships one plugin: **Bran Web**. The bootstrap blockchain snapshot is downloaded separately from [Taj-Coin/tajcoin](https://github.com/Taj-Coin/tajcoin/releases/tag/v1.1).

## Quick start

```bash
cp .env.example .env
./scripts/fetch-bootstrap.sh          # ~530 MB from Taj-Coin GitHub
./scripts/list-tajcoin-apps.sh        # binaries in applications/
docker compose -f docker-compose.yml -f docker-compose.public.yml \
  --profile embedded-ipfs --profile embedded-tajcoin up -d --build
```

Open **http://localhost:8090/** — landing page in 9 languages.

| URL | Role |
|-----|------|
| `/` | Home (i18n) |
| `/panel/` | TajPanel dashboard |
| `/bran-web/edit.html` | Bran Web editor |
| `/editor` | GrapesJS publisher |
| `/wallet/` | MetaMask wallet |

## Languages

English, French, German, Spanish, Portuguese (Brazil), Dutch, Mandarin, Japanese, Swahili — selector on the home page. Override with `?lang=fr` or `localStorage` key `tajnet.lang`.

## Plugins

See **[PLUGINS.md](PLUGINS.md)** — how to extend TajNet. This edition includes **Bran Web** only.

## Tajcoin binaries

Pre-packaged in `applications/` (no extra download). Bootstrap chain state:

```bash
./scripts/fetch-bootstrap.sh
# → Tajcoin/bootstrap-900600.zip from github.com/Taj-Coin/tajcoin
```

## Environment

Set in `.env`:

```env
TAJNET_EDITION=public
TAJCOIN_RPC_USER=tajnet
TAJCOIN_RPC_PASSWORD=changeme
PANEL_PORT=8090
```

## Security

- No `.env`, credentials, or operator data are included in this tree.
- Run `./scripts/verify-public-release.sh` before publishing to GitHub.

## License

MIT — Tajcoin core: see [Taj-Coin/tajcoin](https://github.com/Taj-Coin/tajcoin).
