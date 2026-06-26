"use strict";

const fs = require("fs");
const path = require("path");

function normalizeEndpoint(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

function parseSecretsEnv(content) {
  const kv = {};
  for (const line of String(content || "").split("\n")) {
    const m = line.match(/^([^:#]+)\s*:\s*(.+)$/);
    if (m) kv[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return kv;
}

function resolveSecretsDir() {
  const candidates = [
    process.env.PULSE_SECRETS_DIR,
    path.join(process.env.TAJNET_DATA_DIR || "", "..", "secrets", "nodes"),
    path.join(process.cwd(), "secrets", "nodes"),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function loadSecretsNodes(defaultPort) {
  const dir = resolveSecretsDir();
  if (!dir) return [];

  const nodes = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".env") || file.includes(".example")) continue;
    const slug = file.replace(/\.env$/, "");
    if (slug === "node" || slug === "saopaulo") continue;

    const kv = parseSecretsEnv(fs.readFileSync(path.join(dir, file), "utf8"));
    const ip = kv.ip;
    if (!ip || /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) === false) continue;

    const port = Number(kv.tajnet_port || kv.panel_port || defaultPort || 8090);
    const label =
      kv.node_name ||
      kv.nodename ||
      kv.label ||
      kv.name ||
      slug.charAt(0).toUpperCase() + slug.slice(1);

    nodes.push({
      id: slug,
      label,
      url: `http://${ip}:${port}`,
      source: "secrets",
    });
  }
  return nodes;
}

function loadDataPulseNodes(dataDir) {
  if (!dataDir) return [];
  const file = path.join(dataDir, "pulse", "nodes.json");
  if (!fs.existsSync(file)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed.nodes || [];
    return list
      .filter((n) => n && n.url)
      .map((n) => ({
        id: n.id || n.label,
        label: n.label || n.id,
        url: normalizeEndpoint(n.url),
        source: "data-pulse",
      }));
  } catch {
    return [];
  }
}

function loadPresetNodes(rootDir) {
  if (!rootDir) return [];
  const file = path.join(rootDir, "panel", "pulse", "presets", "lan-nodes.json");
  if (!fs.existsSync(file)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed.nodes || [];
    return list
      .filter((n) => n && n.url)
      .map((n) => ({
        id: n.id || n.label,
        label: n.label || n.id,
        url: normalizeEndpoint(n.url),
        source: "preset",
      }));
  } catch {
    return [];
  }
}

module.exports = {
  loadSecretsNodes,
  loadDataPulseNodes,
  loadPresetNodes,
  resolveSecretsDir,
};
