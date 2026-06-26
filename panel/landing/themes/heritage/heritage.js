"use strict";

const AGENT_IMAGES = {
  tamara: "/themes/heritage/agents/tamara.jpg",
  olga: "/themes/heritage/agents/olga.jpg",
  anna: "/themes/heritage/agents/anna.jpg",
};

const DEFAULT_AGENTS = [
  {
    id: "tamara",
    code: "FM-011",
    name: "Tamara",
    role: "Spiritualité · résilience",
    accent: "tamara",
    image: AGENT_IMAGES.tamara,
    quote:
      "La chaîne est un fil d'or entre les générations — chaque bloc porte la mémoire de ceux qui ont tenu la flamme.",
  },
  {
    id: "olga",
    code: "FM-008",
    name: "Olga Vinikova",
    role: "Rédaction · héritage écrit",
    accent: "olga",
    image: AGENT_IMAGES.olga,
    quote:
      "Archiver, c'est écrire pour demain. Chaque page publiée sur IPFS devient une lettre ouverte à l'histoire.",
  },
  {
    id: "anna",
    code: "FM-007",
    name: "Anna Petrescu",
    role: "Géopolitique · mémoire des peuples",
    accent: "anna",
    image: AGENT_IMAGES.anna,
    quote:
      "Un nœud souverain tient debout quand les empires tremblent — la géopolitique du décentralisé commence ici.",
  },
];

function setText(id, value, html = false) {
  const el = document.getElementById(id);
  if (!el || value == null || value === "") return;
  if (html) el.innerHTML = String(value);
  else el.textContent = value;
}

function setLink(id, label, url) {
  const el = document.getElementById(id);
  if (!el) return;
  if (label) el.textContent = label;
  if (url) el.href = url;
}

function agentPortrait(a) {
  const src = a.image || a.img || AGENT_IMAGES[a.id];
  const alt = a.name ? `Portrait ${a.name}` : "Agent Futuremen";
  if (src) {
    return `<img class="agent-avatar agent-photo" src="${src}" alt="${alt}" width="64" height="64" loading="lazy">`;
  }
  return `<div class="agent-avatar" aria-hidden="true">${(a.name || "?").slice(0, 2).toUpperCase()}</div>`;
}

function renderAgents(agents) {
  const grid = document.getElementById("agentsGrid");
  if (!grid) return;
  const list = Array.isArray(agents) && agents.length ? agents : DEFAULT_AGENTS;
  grid.innerHTML = list
    .map(
      (a) => `
    <article class="agent-card ${a.accent || a.id || ""}">
      <div class="agent-meta">
        ${agentPortrait(a)}
        <div>
          <div class="agent-id">${a.code || ""}</div>
          <div class="agent-name">${a.name || ""}</div>
          <div class="agent-role">${a.role || ""}</div>
        </div>
      </div>
      <blockquote class="agent-quote">${a.quote || ""}</blockquote>
    </article>`
    )
    .join("");
}

function applyProfile(profile) {
  if (!profile) return;
  setText("heritageLogo", profile.nodeName);
  setText("heroTag", profile.tagline);
  setText("heroTitle", profile.heroTitle, true);
  setText("heroLead", profile.heroLead);
  setLink("primaryCta", profile.primaryCtaLabel, profile.primaryCtaUrl);
  setLink("secondaryCta", profile.secondaryCtaLabel, profile.secondaryCtaUrl);
  setLink("headerCta", profile.primaryCtaLabel || "TajPanel", profile.primaryCtaUrl || "/panel/");
  setText("footerText", profile.footerText);
  setText("footerCredits", profile.footerCredits);
  setText("sectionTag", profile.sectionTag);
  setText("sectionTitle", profile.sectionTitle);
  setText("sectionLead", profile.sectionLead);
  if (profile.pageTitle) document.title = profile.pageTitle;
  renderAgents(profile.agents);
}

function setLive(id, text, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove("ok", "off");
  if (ok === true) el.classList.add("ok");
  if (ok === false) el.classList.add("off");
}

async function refreshStatus() {
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  try {
    const res = await fetch("/api/status", { headers: { Accept: "application/json" } });
    const data = await res.json();
    const online = data.status === "online";
    dot?.classList.toggle("online", online);
    dot?.classList.toggle("degraded", !online);
    if (text) text.textContent = online ? "En ligne" : "Dégradé";

    setLive("liveIpfs", data.ipfs?.online ? "En ligne" : "Hors ligne", data.ipfs?.online);
    setLive("liveTajcoin", data.tajcoin?.online ? "En ligne" : "Hors ligne", data.tajcoin?.online);
    setLive(
      "liveBlocks",
      data.tajcoin?.blocks != null ? String(data.tajcoin.blocks).replace(/\B(?=(\d{3})+(?!\d))/g, " ") : "—",
      data.tajcoin?.online
    );
  } catch {
    dot?.classList.add("degraded");
    if (text) text.textContent = "Hors ligne";
    setLive("liveIpfs", "—", null);
    setLive("liveTajcoin", "—", null);
    setLive("liveBlocks", "—", null);
  }
}

async function loadProfile() {
  try {
    const res = await fetch("/api/landing/profile");
    if (!res.ok) throw new Error("profile");
    const data = await res.json();
    applyProfile(data.profile || data);
  } catch {
    applyProfile({});
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadProfile();
  refreshStatus();
  setInterval(refreshStatus, 30000);
});
