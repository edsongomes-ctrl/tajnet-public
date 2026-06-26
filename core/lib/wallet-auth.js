"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { verifyMessage } = require("ethers");

const SESSION_DURATION = 24 * 60 * 60 * 1000;
const sessions = new Map();

const ROOT_DIR = fs.existsSync(path.join(__dirname, "..", "panel", "src"))
  ? path.join(__dirname, "..")
  : path.join(__dirname, "..", "..");
const DATA_DIR = process.env.TAJNET_DATA_DIR || path.join(ROOT_DIR, "data");
const SESSIONS_FILE = path.join(DATA_DIR, "wallet", "sessions.json");

function loadSessionsFromDisk() {
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, "utf8");
    const data = JSON.parse(raw);
    const now = Date.now();
    for (const [id, session] of Object.entries(data || {})) {
      if (session?.expiresAt && now <= session.expiresAt) {
        sessions.set(id, session);
      }
    }
  } catch {
    /* fichier absent ou invalide */
  }
}

function persistSessionsToDisk() {
  try {
    fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2));
  } catch {
    /* non bloquant */
  }
}

loadSessionsFromDisk();

function isValidEthereumAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function isValidSignature(signature) {
  return /^0x[a-fA-F0-9]{130}$/.test(signature);
}

function isValidTimestamp(timestamp) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return false;
  }
  return Math.abs(Date.now() - ts) <= 5 * 60 * 1000;
}

function createSessionId() {
  return crypto.randomBytes(32).toString("hex");
}

function verifyEthSignature(ethereumAddress, message, signature) {
  const recovered = verifyMessage(message, signature);
  return recovered.toLowerCase() === ethereumAddress.toLowerCase();
}

function createSession({ ethereumAddress, accountName, tajcoinAddress, allAddresses, rpcProfile }) {
  const sessionId = createSessionId();
  const now = Date.now();

  const session = {
    sessionId,
    ethereumAddress: ethereumAddress.toLowerCase(),
    accountName,
    tajcoinAddress,
    allAddresses: allAddresses || [tajcoinAddress],
    rpcProfile: rpcProfile || { id: "local", label: "Nœud local" },
    createdAt: now,
    expiresAt: now + SESSION_DURATION,
  };

  sessions.set(sessionId, session);
  persistSessionsToDisk();
  return session;
}

function getSession(sessionId) {
  if (!sessionId || typeof sessionId !== "string") {
    return null;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }

  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    persistSessionsToDisk();
    return null;
  }

  return session;
}

function destroySession(sessionId) {
  sessions.delete(sessionId);
  persistSessionsToDisk();
}

function assertSignedPayload({ ethereumAddress, signature, message, timestamp }) {
  if (!ethereumAddress || !signature || !message || !timestamp) {
    throw new Error("Paramètres manquants");
  }
  if (!isValidEthereumAddress(ethereumAddress)) {
    throw new Error("Adresse Ethereum invalide");
  }
  if (!isValidSignature(signature)) {
    throw new Error("Format de signature invalide");
  }
  if (!isValidTimestamp(timestamp)) {
    throw new Error("Signature expirée (max 5 minutes)");
  }

  const normalizedMessage = typeof message === "string" ? message.trim() : "";
  if (!normalizedMessage || normalizedMessage.length > 2000) {
    throw new Error("Message de signature invalide");
  }
  if (!verifyEthSignature(ethereumAddress, normalizedMessage, signature)) {
    throw new Error("Signature invalide");
  }

  return { ethereumAddress, sanitizedMessage: normalizedMessage };
}

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(id);
      changed = true;
    }
  }
  if (changed) {
    persistSessionsToDisk();
  }
}, 10 * 60 * 1000);

module.exports = {
  createSession,
  getSession,
  destroySession,
  assertSignedPayload,
  isValidEthereumAddress,
};
