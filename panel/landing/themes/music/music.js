"use strict";

const AGENT_IMAGES = {
  echo: "/themes/music/agents/echo.jpg",
  abel: "/themes/music/agents/abel.jpg",
  scriptor: "/themes/music/agents/scriptor.jpg",
};

const DEFAULT_AGENTS = [
  {
    id: "echo",
    code: "FM-004",
    name: "Echo",
    role: "Visionnaire créative",
    accent: "echo",
    image: AGENT_IMAGES.echo,
    quote:
      "Chaque CID est une partition — le nœud n'est qu'une salle de concert où les échos se rencontrent.",
  },
  {
    id: "abel",
    code: "FM-009",
    name: "Abel",
    role: "Phonographe · culture musicale",
    accent: "abel",
    image: AGENT_IMAGES.abel,
    quote:
      "Du jazz au synthwave, de la soul à l'ambient — je traduis la blockchain en langage musical.",
  },
  {
    id: "scriptor",
    code: "FM-010",
    name: "Scriptor",
    role: "Développeur JS",
    accent: "scriptor",
    image: AGENT_IMAGES.scriptor,
    quote: "manifest.json · handlers · restart. Le reste, c'est du bruit de fond bien mixé.",
  },
];

function buildEqualizer() {
  const el = document.getElementById("equalizer");
  if (!el) return;
  for (let i = 0; i < 7; i += 1) {
    const bar = document.createElement("span");
    bar.style.height = `${30 + Math.random() * 70}%`;
    el.appendChild(bar);
  }
}

function setText(id, value, html = false) {
  const el = document.getElementById(id);
  if (!el || value == null || value === "") return;
  if (html) {
    el.innerHTML = String(value).replace(/\n/g, "<br>");
  } else {
    el.textContent = value;
  }
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
  setText("musicLogo", profile.nodeName);
  setText("heroTag", profile.tagline);
  setText("heroTitle", profile.heroTitle, true);
  setText("heroLead", profile.heroLead);
  setLink("primaryCta", profile.primaryCtaLabel, profile.primaryCtaUrl);
  setLink("secondaryCta", profile.secondaryCtaLabel, profile.secondaryCtaUrl);
  setLink("headerCta", profile.primaryCtaLabel || "TajPanel", profile.primaryCtaUrl || "/panel/");
  setText("footerText", profile.footerText);
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
  buildEqualizer();
  loadProfile();
  refreshStatus();
  setInterval(refreshStatus, 30000);
});
