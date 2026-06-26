"use strict";

const os = require("os");
const path = require("path");
const {
  loadSecretsNodes,
  loadDataPulseNodes,
  loadPresetNodes,
} = require("./pulse-nodes-config");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PROBE_TIMEOUT_MS = Number(process.env.PULSE_PROBE_TIMEOUT_MS || 4000);

function isLanHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (LOCAL_HOSTS.has(host)) return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

function endpointHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isLanEndpoint(url) {
  return isLanHost(endpointHost(url));
}

function normalizeEndpoint(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

function sourceId(label, index, url) {
  const slug = String(label)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (slug) return slug;
  try {
    return new URL(url).hostname.replace(/\./g, "-") || `node-${index + 1}`;
  } catch {
    return `node-${index + 1}`;
  }
}

function labelForUrl(url) {
  try {
    const u = new URL(url);
    if (LOCAL_HOSTS.has(u.hostname)) return "localhost";
    return u.hostname;
  } catch {
    return url;
  }
}

function parseNodeUrls(raw) {
  if (!String(raw || "").trim()) return [];
  return String(raw)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => {
      const pipe = part.indexOf("|");
      const url = normalizeEndpoint(pipe !== -1 ? part.slice(0, pipe).trim() : part);
      const label = pipe !== -1 ? part.slice(pipe + 1).trim() : labelForUrl(url);
      return {
        id: sourceId(label, index, url),
        label,
        url,
        source: "config",
      };
    });
}

function localLanEndpoints(port) {
  const urls = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (isLanHost(entry.address)) {
        urls.add(`http://${entry.address}:${port}`);
      }
    }
  }
  return [...urls];
}

function collectCandidates(discover, clientOrigin, options = {}) {
  const port = Number(process.env.PANEL_PORT || 8090);
  const dataDir = options.dataDir || process.env.TAJNET_DATA_DIR;
  const rootDir = options.rootDir;
  const seen = new Set();
  const nodes = [];

  const push = (candidate) => {
    const url = normalizeEndpoint(candidate.url);
    if (!url || !isLanEndpoint(url) || seen.has(url)) return;
    seen.add(url);
    nodes.push({
      id: candidate.id || sourceId(candidate.label || url, nodes.length, url),
      label: candidate.label || labelForUrl(url),
      url,
      source: candidate.source || "config",
    });
  };

  const localUrls = localLanEndpoints(port);
  const preferredLocal =
    localUrls.find((u) => /192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\./.test(u)) ||
    localUrls.find((u) => u.includes("127.0.0.1")) ||
    localUrls[0];
  if (preferredLocal) {
    push({ id: "local", label: "Ce nœud", url: preferredLocal, source: "local" });
  }

  const profileEndpoint = normalizeEndpoint(discover?.profile?.endpoint);
  if (profileEndpoint && isLanEndpoint(profileEndpoint)) {
    push({
      id: "local-profile",
      label: discover.profile?.name || labelForUrl(profileEndpoint),
      url: profileEndpoint,
      source: "discover-profile",
    });
  }

  if (clientOrigin && isLanEndpoint(clientOrigin)) {
    push({
      id: "client",
      label: labelForUrl(clientOrigin),
      url: clientOrigin,
      source: "client",
    });
  }

  for (const partner of discover?.partners?.partners || []) {
    const url = normalizeEndpoint(partner.endpoint);
    if (!url) continue;
    push({
      id: partner.id || sourceId(partner.name || url, nodes.length, url),
      label: partner.name || labelForUrl(url),
      url,
      source: "discover-partner",
    });
  }

  for (const preset of loadPresetNodes(rootDir)) {
    push(preset);
  }

  for (const secretNode of loadSecretsNodes(port)) {
    push(secretNode);
  }

  for (const dataNode of loadDataPulseNodes(dataDir)) {
    push(dataNode);
  }

  const envRaw = [process.env.PULSE_NODE_URLS, process.env.FUTUREMEN_NODE_URLS]
    .filter(Boolean)
    .join(",");
  for (const parsed of parseNodeUrls(envRaw)) {
    push(parsed);
  }

  return nodes;
}

async function fetchStatus(url) {
  const started = Date.now();
  const res = await fetch(`${normalizeEndpoint(url)}/api/status`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { data, latencyMs: Date.now() - started };
}

async function probeNode(candidate) {
  const base = normalizeEndpoint(candidate.url);
  try {
    const { data, latencyMs } = await fetchStatus(base);
    const nodeName = data.landing?.nodeName || data.discover?.profile?.name || candidate.label;
    return {
      ...candidate,
      online: data.status === "online" || data.engine === "online",
      latencyMs,
      edition: data.edition || null,
      requestZone: data.requestZone || null,
      nodeName,
      landing: {
        theme: data.landing?.theme || null,
        nodeName: data.landing?.nodeName || null,
        tagline: data.landing?.tagline || null,
      },
      ipfs: {
        online: Boolean(data.ipfs?.online ?? data.ipfs?.ready),
        peerCount: data.ipfs?.peerCount ?? null,
      },
      tajcoin: {
        online: Boolean(data.tajcoin?.online),
        blocks: data.tajcoin?.blocks ?? data.tajcoin?.blockHeight ?? null,
      },
      discover: {
        enabled: Boolean(data.discover?.enabled),
        entryCount: data.discover?.entryCount ?? null,
        public: Boolean(data.discover?.profile?.public ?? data.discover?.publicProfile?.public),
      },
      links: {
        home: `${base}/`,
        panel: `${base}/panel/`,
        futuremen: data.edition === "public" ? null : `${base}/futuremen/`,
        pulse: `${base}/pulse/`,
      },
      error: null,
    };
  } catch (err) {
    return {
      ...candidate,
      online: false,
      latencyMs: null,
      edition: null,
      nodeName: candidate.label,
      landing: null,
      ipfs: null,
      tajcoin: null,
      discover: null,
      links: {
        home: `${base}/`,
        panel: `${base}/panel/`,
        futuremen: null,
        pulse: `${base}/pulse/`,
      },
      error: err.message || "Hors ligne",
    };
  }
}

function dedupeProbed(nodes) {
  const byKey = new Map();
  for (const node of nodes) {
    const key =
      node.online && node.nodeName
        ? `${node.nodeName}::${node.edition || "?"}`
        : normalizeEndpoint(node.url);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, node);
      continue;
    }
    const prefer =
      (node.online && !existing.online) ||
      (node.online === existing.online &&
        String(node.url).includes("192.168.") &&
        !String(existing.url).includes("192.168."))
        ? node
        : existing;
    byKey.set(key, prefer);
  }
  return [...byKey.values()];
}

function sortNodes(nodes) {
  return nodes.sort((a, b) => {
    if (a.source === "local" && b.source !== "local") return -1;
    if (b.source === "local" && a.source !== "local") return 1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return String(a.label).localeCompare(String(b.label), "fr");
  });
}

async function buildPulseRegistry(discover, { clientOrigin, dataDir, rootDir } = {}) {
  const candidates = collectCandidates(discover, clientOrigin, { dataDir, rootDir });
  const probed = await Promise.all(candidates.map((c) => probeNode(c)));
  const nodes = sortNodes(dedupeProbed(probed));
  const onlineCount = nodes.filter((n) => n.online).length;

  return {
    generatedAt: new Date().toISOString(),
    probeTimeoutMs: PROBE_TIMEOUT_MS,
    candidateCount: candidates.length,
    nodeCount: nodes.length,
    onlineCount,
    nodes,
  };
}

module.exports = {
  buildPulseRegistry,
  collectCandidates,
  isLanEndpoint,
  isLanHost,
};
