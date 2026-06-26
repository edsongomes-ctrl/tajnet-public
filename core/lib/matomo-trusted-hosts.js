"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const MATOMO_URL = (process.env.MATOMO_URL || "http://127.0.0.1:8888").replace(/\/$/, "");
const MATOMO_INTERNAL = new URL(`${MATOMO_URL}/`);

function defaultConfigPath() {
  if (process.env.MATOMO_CONFIG_FILE) {
    return process.env.MATOMO_CONFIG_FILE;
  }
  const dataDir = process.env.TAJNET_DATA_DIR || path.join(__dirname, "..", "..", "data");
  return path.join(dataDir, "matomo", "config", "config.ini.php");
}

function collectRequiredTrustedHosts() {
  const matomoPort = MATOMO_INTERNAL.port || "8888";
  const panelPort = String(process.env.PANEL_PORT || "8090");
  const tlsPort = String(process.env.TLS_PORT || "8443");
  const tlsEnabled =
    process.env.TLS_ENABLED === "true" ||
    (process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE);
  const hosts = new Set([
    `127.0.0.1:${matomoPort}`,
    `localhost:${matomoPort}`,
    `127.0.0.1:${panelPort}`,
    `localhost:${panelPort}`,
  ]);

  if (tlsEnabled) {
    hosts.add(`127.0.0.1:${tlsPort}`);
    hosts.add(`localhost:${tlsPort}`);
  }

  for (const entry of String(process.env.MATOMO_TRUSTED_HOSTS || "").split(",")) {
    const host = entry.trim();
    if (host) {
      hosts.add(host);
    }
  }

  try {
    for (const ifaces of Object.values(os.networkInterfaces())) {
      for (const iface of ifaces || []) {
        if (iface.family === "IPv4" && !iface.internal) {
          hosts.add(`${iface.address}:${matomoPort}`);
          hosts.add(`${iface.address}:${panelPort}`);
          if (tlsEnabled) {
            hosts.add(`${iface.address}:${tlsPort}`);
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return hosts;
}

function parseTrustedHosts(content) {
  const hosts = new Set();
  for (const line of String(content).split("\n")) {
    const match = line.match(/^trusted_hosts\[\]\s*=\s*"([^"]+)"/);
    if (match) {
      hosts.add(match[1]);
    }
  }
  return hosts;
}

function upsertTrustedHosts(content, hosts) {
  const lines = String(content).split("\n");
  const filtered = lines.filter((line) => !/^trusted_hosts\[\]/.test(line));
  const hostLines = Array.from(hosts)
    .sort()
    .map((host) => `trusted_hosts[] = "${host}"`);

  const generalIndex = filtered.findIndex((line) => /^\[General\]\s*$/.test(line));
  if (generalIndex === -1) {
    return `${filtered.join("\n").trimEnd()}\n\n[General]\n${hostLines.join("\n")}\n`;
  }

  let insertAt = generalIndex + 1;
  while (insertAt < filtered.length && !/^\[/.test(filtered[insertAt])) {
    insertAt += 1;
  }

  filtered.splice(insertAt, 0, ...hostLines);
  return `${filtered.join("\n").trimEnd()}\n`;
}

function resolvePublicTrackingBase() {
  const explicit = (process.env.MATOMO_PUBLIC_URL || "").replace(/\/$/, "");
  if (explicit && explicit !== MATOMO_URL.replace(/\/$/, "")) {
    return explicit;
  }
  const endpoint = (process.env.DISCOVER_NODE_ENDPOINT || "").replace(/\/$/, "");
  if (endpoint) {
    return `${endpoint}/matomo`;
  }
  return null;
}

function syncMatomoTrustedHosts(options = {}) {
  const configPath = options.configPath || defaultConfigPath();
  if (!fs.existsSync(configPath)) {
    return { synced: false, reason: "config_missing", path: configPath };
  }

  const required = collectRequiredTrustedHosts();
  const content = fs.readFileSync(configPath, "utf8");
  const existing = parseTrustedHosts(content);
  const merged = new Set([...existing, ...required]);

  const unchanged =
    merged.size === existing.size && [...merged].every((host) => existing.has(host));
  if (unchanged) {
    return { synced: false, reason: "unchanged", hosts: [...merged], path: configPath };
  }

  try {
    fs.writeFileSync(configPath, upsertTrustedHosts(content, merged), "utf8");
  } catch (err) {
    return {
      synced: false,
      reason: "write_failed",
      error: err.message,
      hosts: [...merged],
      path: configPath,
    };
  }
  return { synced: true, hosts: [...merged], path: configPath };
}

module.exports = {
  collectRequiredTrustedHosts,
  resolvePublicTrackingBase,
  syncMatomoTrustedHosts,
};
