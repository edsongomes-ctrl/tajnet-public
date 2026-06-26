"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_PROFILE = {
  theme: "default",
  nodeName: "TAJNET",
  tagline: "Graine v0.1 — nœud public · tajnet.cloud",
  heroTitle: "TajNet\nDocumentation",
  heroLead:
    "Nœud personnel souverain : IPFS, Tajcoin (TAJ), Guard, Discover et économie de contenu. Premier nœud public en production — tajnet.cloud.",
  primaryCtaLabel: "Ouvrir le TajPanel →",
  primaryCtaUrl: "/panel/",
  secondaryCtaLabel: "Démarrage rapide",
  secondaryCtaUrl: "#demarrage-rapide",
  footerText: "TAJNET GRAINE v0.1 — tajnet.cloud · Souveraineté numérique",
  contactEmail: "info@tajnet.cloud",
  showDeploymentSection: true,
};

function profilePath(dataDir) {
  const base = dataDir || process.env.TAJNET_DATA_DIR || path.join(__dirname, "..", "..", "data");
  return path.join(base, "landing", "profile.json");
}

function loadLandingProfile(dataDir) {
  const file = profilePath(dataDir);
  if (!fs.existsSync(file)) {
    return { ...DEFAULT_PROFILE };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...DEFAULT_PROFILE, ...parsed };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

function saveLandingProfile(dataDir, profile) {
  const file = profilePath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const merged = { ...DEFAULT_PROFILE, ...profile };
  fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}

const THEMED_LANDING = {
  music: path.join("themes", "music", "index.html"),
  heritage: path.join("themes", "heritage", "index.html"),
};

function resolveLandingIndex({ landingDir, dataDir, isPublic }) {
  const profile = loadLandingProfile(dataDir);
  if (isPublic && profile.theme && THEMED_LANDING[profile.theme]) {
    const themedIndex = path.join(landingDir, THEMED_LANDING[profile.theme]);
    if (fs.existsSync(themedIndex)) return themedIndex;
  }
  if (isPublic) {
    const publicIndex = path.join(landingDir, "public", "index.html");
    if (fs.existsSync(publicIndex)) return publicIndex;
  }
  return path.join(landingDir, "index.html");
}

module.exports = {
  DEFAULT_PROFILE,
  loadLandingProfile,
  saveLandingProfile,
  resolveLandingIndex,
};
