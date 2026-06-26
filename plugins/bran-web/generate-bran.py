#!/usr/bin/env python3
"""
Bran Web — générateur de structure modulaire depuis workflow-bran.md

Usage:
    python3 generate-bran.py              # génère dans le dossier courant
    python3 generate-bran.py --check      # vérifie sans écrire
    python3 generate-bran.py --file path  # fichier source alternatif
"""

from __future__ import annotations

import argparse
import html
import re
import shutil
import sys
from pathlib import Path

SECTION_MARKERS = ("@bio", "@source")
IMAGE_SLOTS = {
    "image_header_copy_from": ("photo1up", "image_header_alt"),
    "image_footer_copy_from": ("photo2down", "image_footer_alt"),
}

INDEX_TEMPLATE = """<!DOCTYPE html>
<html lang="{lang}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>

    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Share+Tech+Mono&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="style.css">

    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body class="{theme}"
      data-header-alt="{header_alt}"
      data-footer-alt="{footer_alt}"
      data-console-log="{console_log}">

    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>

    <nav>
        <a href="#" class="nav-logo">{nav_logo}<span>{nav_logo_accent}</span></a>
        <ul class="nav-links">
            <li><a href="#bio-container">{nav_bio}</a></li>
            <li><a href="#article-container">{nav_article}</a></li>
            <li><a href="edit.html">{nav_edit}</a></li>
        </ul>
        <div class="nav-status"><div class="status-dot"></div>{nav_status}</div>
    </nav>

    <div class="app-wrapper">
        <div id="container" class="book-pages">
            <div class="book-header">
                <span class="running-title">{running_title}</span>
                <span class="running-page">{running_page}</span>
            </div>

            <section id="bio-container" class="markdown-body agent-bio">
                <p class="loader">{loader_bio}</p>
            </section>

            <hr class="divider">

            <article id="article-container" class="markdown-body">
                <p class="loader">{loader_article}</p>
            </article>
        </div>
    </div>

    <script src="script.js" defer></script>
</body>
</html>
"""


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---"):
        raise ValueError("workflow-bran.md doit commencer par un bloc YAML entre ---")

    end = text.find("\n---", 3)
    if end == -1:
        raise ValueError("Frontmatter YAML non fermé (--- manquant)")

    raw_yaml = text[3:end].strip()
    body = text[end + 4 :].lstrip("\n")
    config: dict[str, str] = {}

    for line in raw_yaml.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        config[key] = value

    return config, body


def extract_sections(body: str) -> dict[str, str]:
    pattern = re.compile(r"^##\s+@(\w+)\s*$", re.MULTILINE)
    matches = list(pattern.finditer(body))
    if not matches:
        raise ValueError("Aucune section ## @bio ou ## @source trouvée")

    sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        name = match.group(1)
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        content = body[start:end].strip()
        sections[name] = content

    missing = [name for name in ("bio", "source") if name not in sections]
    if missing:
        raise ValueError(f"Sections obligatoires manquantes : {', '.join('@' + m for m in missing)}")

    return sections


def escape_attr(value: str) -> str:
    return html.escape(value, quote=True)



def build_index(config: dict[str, str]) -> str:
    fields = {
        "lang": config.get("lang", "fr"),
        "title": escape_attr(config.get("title", "Bran Web")),
        "theme": escape_attr(config.get("theme", "theme-enfants-foret")),
        "nav_logo": html.escape(config.get("nav_logo", "BRAN")),
        "nav_logo_accent": html.escape(config.get("nav_logo_accent", "WEB")),
        "nav_bio": html.escape(config.get("nav_bio", "I / BIO")),
        "nav_article": html.escape(config.get("nav_article", "II / SOURCE")),
        "nav_edit": html.escape(config.get("nav_edit", "✎ ÉDITER")),
        "nav_status": html.escape(config.get("nav_status", "ARCHIVE · ACTIF")),
        "running_title": html.escape(config.get("running_title", "Archive Bran Web")),
        "running_page": html.escape(config.get("running_page", "")),
        "loader_bio": html.escape(config.get("loader_bio", "Chargement...")),
        "loader_article": html.escape(config.get("loader_article", "Chargement...")),
        "header_alt": escape_attr(config.get("image_header_alt", "Photo d'en-tête")),
        "footer_alt": escape_attr(config.get("image_footer_alt", "Pied de page")),
        "console_log": escape_attr(config.get("console_log", "Bran Web : chargement réussi.")),
    }
    return INDEX_TEMPLATE.format(**fields)


def generate(root: Path, workflow_file: Path, dry_run: bool = False) -> list[str]:
    text = workflow_file.read_text(encoding="utf-8")
    config, body = parse_frontmatter(text)
    sections = extract_sections(body)
    actions: list[str] = []

    outputs = {
        root / "bio.md": sections["bio"],
        root / "source.md": sections["source"],
        root / "index.html": build_index(config),
    }

    for path, content in outputs.items():
        actions.append(f"écrit {path.relative_to(root)}")
        if not dry_run:
            path.write_text(content if content.endswith("\n") else content + "\n", encoding="utf-8")

    for copy_key, (slot, _alt_key) in IMAGE_SLOTS.items():
        source_rel = config.get(copy_key, "").strip()
        if not source_rel:
            continue
        source = root / source_rel
        if not source.is_file():
            raise FileNotFoundError(f"Image source introuvable : {source_rel}")
        target = root / "image" / f"{slot}{source.suffix.lower()}"
        actions.append(f"copie {source_rel} → {target.relative_to(root)}")
        if not dry_run:
            target.parent.mkdir(exist_ok=True)
            shutil.copy2(source, target)

    if not dry_run and not (root / "style.css").is_file():
        scaffold = root / "_scaffold" / "style.css"
        if scaffold.is_file():
            shutil.copy2(scaffold, root / "style.css")
            actions.append("copie _scaffold/style.css → style.css")
        else:
            actions.append("⚠ style.css absent — copiez-le manuellement depuis un projet Bran Web existant")

    if not dry_run and not (root / "script.js").is_file():
        scaffold = root / "_scaffold" / "script.js"
        if scaffold.is_file():
            shutil.copy2(scaffold, root / "script.js")
            actions.append("copie _scaffold/script.js → script.js")

    return actions


def main() -> int:
    parser = argparse.ArgumentParser(description="Génère la structure Bran Web depuis workflow-bran.md")
    parser.add_argument("--file", default="workflow-bran.md", help="Chemin vers le fichier workflow")
    parser.add_argument("--root", default=".", help="Racine du projet Bran Web")
    parser.add_argument("--check", action="store_true", help="Valide sans écrire les fichiers")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    workflow_file = (root / args.file).resolve()

    if not workflow_file.is_file():
        print(f"Erreur : {workflow_file} introuvable", file=sys.stderr)
        return 1

    try:
        actions = generate(root, workflow_file, dry_run=args.check)
    except (ValueError, FileNotFoundError) as err:
        print(f"Erreur : {err}", file=sys.stderr)
        return 1

    mode = "Validation OK" if args.check else "Génération terminée"
    print(f"{mode} — {workflow_file.name}")
    for action in actions:
        print(f"  · {action}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
