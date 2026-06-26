"use strict";

const fs = require("fs");
const path = require("path");

const TAJCOIN_RPC_URL = process.env.TAJCOIN_RPC_URL || "http://127.0.0.1:12107";
const TAJCOIN_DATA_DIR = process.env.TAJCOIN_DATA_DIR || "/host-tajcoin";
const TAJCOIN_RPC_USER = process.env.TAJCOIN_RPC_USER || "";
const TAJCOIN_RPC_PASSWORD = process.env.TAJCOIN_RPC_PASSWORD || "";
const TAJCOIN_COOKIE_FILE = process.env.TAJCOIN_COOKIE_FILE || "";
const TAJCOIN_PUBLIC_RPC_URL = (process.env.TAJCOIN_PUBLIC_RPC_URL || "").replace(/\/$/, "");
const TAJCOIN_PUBLIC_RPC_USER = process.env.TAJCOIN_PUBLIC_RPC_USER || "tajcoinrpc";
const TAJCOIN_PUBLIC_RPC_PASSWORD = process.env.TAJCOIN_PUBLIC_RPC_PASSWORD || "";

const LOCAL_PROFILE = { id: "local" };

function findCookieFile(dir) {
  for (const name of ["cookie", ".cookie"]) {
    const filePath = path.join(dir, name);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

function loadRpcFromConf(dir) {
  const confPath = path.join(dir, "tajcoin.conf");
  if (!fs.existsSync(confPath)) {
    return null;
  }

  const content = fs.readFileSync(confPath, "utf8");
  const read = (key) => {
    const match = content.match(new RegExp(`^${key}=(.+)$`, "m"));
    return match ? match[1].trim() : null;
  };

  const user = read("rpcuser");
  const password = read("rpcpassword");
  if (user && password) {
    return { user, password };
  }
  return null;
}

function localRpcAuthHeader() {
  const cookiePath = TAJCOIN_COOKIE_FILE || findCookieFile(TAJCOIN_DATA_DIR);

  if (cookiePath && fs.existsSync(cookiePath)) {
    return Buffer.from(fs.readFileSync(cookiePath, "utf8").trim()).toString("base64");
  }

  const fromConf = loadRpcFromConf(TAJCOIN_DATA_DIR);
  const user = TAJCOIN_RPC_USER || fromConf?.user || "tajnet";
  const password = TAJCOIN_RPC_PASSWORD || fromConf?.password || "changeme";

  return Buffer.from(`${user}:${password}`).toString("base64");
}

function isValidRpcUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function maskRpcUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "rpc";
  }
}

function normalizeRpcProfile(profile = LOCAL_PROFILE) {
  const id = profile?.id || "local";

  if (id === "local") {
    return { id: "local", label: "Nœud local" };
  }

  if (id === "public") {
    if (!TAJCOIN_PUBLIC_RPC_URL || !TAJCOIN_PUBLIC_RPC_PASSWORD) {
      throw new Error("Nœud public RPC non configuré sur le serveur");
    }
    return { id: "public", label: "Nœud public" };
  }

  if (id === "custom") {
    const url = String(profile.url || "").trim().replace(/\/$/, "");
    const username = String(profile.username || profile.user || "").trim();
    const password = String(profile.password || "").trim();

    if (!url || !username || !password) {
      throw new Error("URL, utilisateur et mot de passe RPC requis");
    }
    if (!isValidRpcUrl(url)) {
      throw new Error("URL RPC invalide (http/https uniquement)");
    }

    return { id: "custom", label: "RPC personnalisé", url, username, password };
  }

  throw new Error("Profil RPC inconnu");
}

function resolveRpcTarget(profile = LOCAL_PROFILE) {
  const normalized = normalizeRpcProfile(profile);

  if (normalized.id === "local") {
    return {
      profile: normalized,
      url: TAJCOIN_RPC_URL,
      authorization: `Basic ${localRpcAuthHeader()}`,
    };
  }

  if (normalized.id === "public") {
    return {
      profile: { id: "public", label: normalized.label, url: TAJCOIN_PUBLIC_RPC_URL },
      url: TAJCOIN_PUBLIC_RPC_URL,
      authorization: `Basic ${Buffer.from(`${TAJCOIN_PUBLIC_RPC_USER}:${TAJCOIN_PUBLIC_RPC_PASSWORD}`).toString("base64")}`,
    };
  }

  return {
    profile: {
      id: "custom",
      label: normalized.label,
      url: normalized.url,
      username: normalized.username,
    },
    url: normalized.url,
    authorization: `Basic ${Buffer.from(`${normalized.username}:${normalized.password}`).toString("base64")}`,
  };
}

function sanitizeProfileForClient(profile) {
  if (!profile) {
    return { id: "local", label: "Nœud local" };
  }
  const safe = { id: profile.id, label: profile.label || profile.id };
  if (profile.url) {
    safe.url = maskRpcUrl(profile.url);
  }
  if (profile.username) {
    safe.username = profile.username;
  }
  return safe;
}

function listRpcProfiles() {
  const profiles = [
    {
      id: "local",
      label: "Nœud local (TajNet)",
      endpoint: maskRpcUrl(TAJCOIN_RPC_URL),
      auth: "cookie / tajcoin.conf",
    },
  ];

  if (TAJCOIN_PUBLIC_RPC_URL && TAJCOIN_PUBLIC_RPC_PASSWORD) {
    profiles.push({
      id: "public",
      label: "Nœud public Tajcoin",
      endpoint: maskRpcUrl(TAJCOIN_PUBLIC_RPC_URL),
      auth: "config serveur",
    });
  }

  profiles.push({
    id: "custom",
    label: "RPC personnalisé",
    customizable: true,
  });

  return profiles;
}

function parseRpcProfileFromRequest(body = {}) {
  return normalizeRpcProfile(body.rpc || LOCAL_PROFILE);
}

async function tajcoinRpc(method, params = [], profile = LOCAL_PROFILE) {
  const { url, authorization } = resolveRpcTarget(profile);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorization,
    },
    body: JSON.stringify({ jsonrpc: "1.0", id: "tajnet", method, params }),
  });

  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    if (!res.ok) {
      throw new Error(`Tajcoin RPC HTTP ${res.status}${text ? ` — ${text.slice(0, 120)}` : ""}`);
    }
    throw new Error("Réponse Tajcoin RPC invalide");
  }

  if (!res.ok || payload.error) {
    const msg = payload.error?.message || `Tajcoin RPC HTTP ${res.status}`;
    const code = payload.error?.code != null ? ` (${payload.error.code})` : "";
    throw new Error(`${msg}${code}`);
  }
  return payload.result;
}

async function testRpcProfile(profile = LOCAL_PROFILE) {
  const { profile: safeProfile, url } = resolveRpcTarget(profile);
  const info = await tajcoinRpc("getinfo", [], profile);

  return {
    connected: true,
    profile: sanitizeProfileForClient(safeProfile),
    endpoint: maskRpcUrl(url),
    blocks: info.blocks,
    connections: info.connections,
    version: info.version,
    balance: info.balance,
  };
}

async function getStatus(profile = LOCAL_PROFILE) {
  try {
    const info = await tajcoinRpc("getinfo", [], profile);
    return {
      online: true,
      blocks: info.blocks,
      connections: info.connections,
      balance: info.balance,
      version: info.version,
      rpcProfile: sanitizeProfileForClient(normalizeRpcProfile(profile)),
    };
  } catch (err) {
    return { online: false, error: err.message };
  }
}

module.exports = {
  LOCAL_PROFILE,
  TAJCOIN_RPC_URL,
  listRpcProfiles,
  normalizeRpcProfile,
  parseRpcProfileFromRequest,
  sanitizeProfileForClient,
  resolveRpcTarget,
  testRpcProfile,
  tajcoinRpc,
  getStatus,
};
