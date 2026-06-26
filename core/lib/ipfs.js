"use strict";

const fs = require("fs");
const path = require("path");

const IPFS_GATEWAY_URL = (process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";

async function ipfsId() {
  const res = await fetch(`${IPFS_API_URL}/api/v0/id`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`IPFS indisponible (${res.status})`);
  }
  return res.json();
}

async function getIpfsStatus() {
  try {
    const id = await ipfsId();
    return {
      online: true,
      nodeId: id.ID || id.Id || id.id,
    };
  } catch (err) {
    return { online: false, error: err.message };
  }
}

function parseAddResponse(text, { wrapWithDirectory = false, filename = null } = {}) {
  const lines = text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  if (wrapWithDirectory) {
    const dirEntry = lines.find((entry) => entry.Name === "");
    const baseName = filename ? path.basename(filename) : null;
    const fileEntry = baseName
      ? lines.find((entry) => entry.Name === baseName)
      : lines.find((entry) => entry.Name !== "");

    return {
      cid: dirEntry?.Hash || fileEntry?.Hash || lines[lines.length - 1]?.Hash,
      fileCid: fileEntry?.Hash || lines[lines.length - 1]?.Hash,
      name: fileEntry?.Name || baseName,
      size: fileEntry?.Size,
      entries: lines,
    };
  }

  const last = lines[lines.length - 1];
  return {
    cid: last?.Hash,
    fileCid: last?.Hash,
    name: last?.Name || filename,
    size: last?.Size,
    entries: lines,
  };
}

async function ipfsAdd(form, { wrapWithDirectory = false, cidVersion = 1 } = {}) {
  const params = new URLSearchParams({
    pin: "true",
    "cid-version": String(cidVersion),
  });
  if (wrapWithDirectory) {
    params.set("wrap-with-directory", "true");
  }

  const timeoutMs = Number(process.env.IPFS_ADD_TIMEOUT_MS || 300_000);
  const res = await fetch(`${IPFS_API_URL}/api/v0/add?${params}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Échec ajout IPFS (${res.status})${detail ? ` — ${detail}` : ""}`);
  }

  return res.text();
}

async function addBufferToIpfs(buffer, filename, options = {}) {
  const form = new FormData();
  const name = filename || "file";
  form.append("file", new Blob([buffer]), name);
  const text = await ipfsAdd(form, options);
  return parseAddResponse(text, { ...options, filename: name });
}

async function addFileToIpfs(filePath, filename, options = {}) {
  const name = filename || path.basename(filePath);
  const buffer = fs.readFileSync(filePath);
  return addBufferToIpfs(buffer, name, options);
}

async function addHtmlToIpfs(html, filename = "index.html") {
  const buffer = Buffer.isBuffer(html) ? html : Buffer.from(String(html), "utf8");
  return addBufferToIpfs(buffer, filename, { wrapWithDirectory: true });
}

async function pinCid(cid, { recursive = false } = {}) {
  if (!cid) {
    throw new Error("CID requis");
  }
  const params = new URLSearchParams({ arg: cid });
  if (recursive) {
    params.set("recursive", "true");
  }
  const res = await fetch(`${IPFS_API_URL}/api/v0/pin/add?${params}`, { method: "POST" });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Échec pin IPFS (${res.status})${detail ? ` — ${detail}` : ""}`);
  }
  return res.json().catch(() => ({ Pins: [cid] }));
}

async function pinCidWithFallback(cid) {
  try {
    return await pinCid(cid, { recursive: true });
  } catch {
    return pinCid(cid, { recursive: false });
  }
}

function ipfsGatewayCandidates() {
  const publicGateway = (process.env.IPFS_GATEWAY_PUBLIC_URL || "https://dweb.link").replace(/\/$/, "");
  return [...new Set([IPFS_GATEWAY_URL, publicGateway].filter(Boolean))];
}

async function fetchIpfsText(cid, timeoutMs = 8000) {
  let lastError = null;
  for (const base of ipfsGatewayCandidates()) {
    try {
      const res = await fetch(`${base}/ipfs/${cid}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastError = new Error(`IPFS gateway ${res.status} pour ${cid}`);
        continue;
      }
      return res.text();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error(`IPFS indisponible pour ${cid}`);
}

async function fetchIpfsJson(cid, timeoutMs = 8000) {
  const text = await fetchIpfsText(cid, timeoutMs);
  return JSON.parse(text);
}

module.exports = {
  IPFS_API_URL,
  IPFS_GATEWAY_URL,
  ipfsId,
  getIpfsStatus,
  parseAddResponse,
  addBufferToIpfs,
  addFileToIpfs,
  addHtmlToIpfs,
  fetchIpfsText,
  fetchIpfsJson,
  pinCid,
  pinCidWithFallback,
};
