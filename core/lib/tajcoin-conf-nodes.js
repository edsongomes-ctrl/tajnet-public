"use strict";

const fs = require("fs");
const path = require("path");
const { tajcoinRpc, getStatus } = require("./tajcoin");

const TAJCOIN_DATA_DIR = process.env.TAJCOIN_DATA_DIR || path.join(__dirname, "..", "..", "Tajcoin", "data");
const DEFAULT_P2P_PORT = 10712;

function resolveTajcoinConfPath() {
  const explicit = process.env.TAJCOIN_CONF_FILE;
  if (explicit) {
    return explicit;
  }
  return path.join(TAJCOIN_DATA_DIR, "tajcoin.conf");
}

function normalizeNodeAddress(value) {
  if (value == null) {
    return "";
  }
  let addr = String(value).trim();
  if (!addr) {
    return "";
  }
  addr = addr.replace(/^addnode\s*=\s*/i, "");
  const comment = addr.indexOf("#");
  if (comment !== -1) {
    addr = addr.slice(0, comment).trim();
  }
  return addr;
}

function isValidNodeAddress(addr) {
  if (!addr || typeof addr !== "string") {
    return false;
  }
  const normalized = normalizeNodeAddress(addr);
  if (!normalized || normalized.length > 253) {
    return false;
  }

  const ipv4WithPort = /^(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?$/;
  if (ipv4WithPort.test(normalized)) {
    const [ip, portPart] = normalized.split(":");
    const octets = ip.split(".").map(Number);
    if (octets.some((part) => part > 255)) {
      return false;
    }
    if (portPart) {
      const port = Number(portPart);
      return port >= 1 && port <= 65535;
    }
    return true;
  }

  return /^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(normalized);
}

function parseConfContent(content) {
  const lines = content.split(/\r?\n/);
  const otherLines = [];
  const addnodes = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      otherLines.push(line);
      continue;
    }
    const match = trimmed.match(/^addnode\s*=\s*(.+)$/i);
    if (match) {
      const addr = normalizeNodeAddress(match[1]);
      if (addr && isValidNodeAddress(addr)) {
        addnodes.push(addr);
      }
      continue;
    }
    otherLines.push(line);
  }

  return {
    otherLines,
    addnodes: [...new Set(addnodes)],
  };
}

function readTajcoinConf() {
  const confPath = resolveTajcoinConfPath();
  if (!fs.existsSync(confPath)) {
    return {
      exists: false,
      path: confPath,
      otherLines: [],
      addnodes: [],
    };
  }

  const content = fs.readFileSync(confPath, "utf8");
  const parsed = parseConfContent(content);
  return {
    exists: true,
    path: confPath,
    ...parsed,
  };
}

function writeTajcoinConf({ otherLines, addnodes }) {
  const confPath = resolveTajcoinConfPath();
  const dir = path.dirname(confPath);
  fs.mkdirSync(dir, { recursive: true });

  const trimmedOther = otherLines.filter((line, index, arr) => {
    if (line.trim() !== "") {
      return true;
    }
    return index === 0 || arr[index - 1].trim() !== "";
  });

  while (trimmedOther.length && trimmedOther[trimmedOther.length - 1].trim() === "") {
    trimmedOther.pop();
  }

  const uniqueNodes = [...new Set(addnodes.map(normalizeNodeAddress).filter(Boolean))];
  const body = [...trimmedOther, ...uniqueNodes.map((node) => `addnode=${node}`)].join("\n");
  fs.writeFileSync(confPath, `${body}\n`, "utf8");

  return {
    path: confPath,
    addnodes: uniqueNodes,
  };
}

function tajcoinNodesStatus() {
  const conf = readTajcoinConf();
  return {
    available: conf.exists,
    path: conf.path,
    count: conf.addnodes.length,
    addnodes: conf.addnodes,
    defaultP2pPort: DEFAULT_P2P_PORT,
    reason: conf.exists ? undefined : "tajcoin.conf introuvable",
  };
}

function listAddNodes() {
  const conf = readTajcoinConf();
  if (!conf.exists) {
    const err = new Error("tajcoin.conf introuvable");
    err.status = 404;
    throw err;
  }
  return {
    path: conf.path,
    addnodes: conf.addnodes,
    defaultP2pPort: DEFAULT_P2P_PORT,
  };
}

function normalizeNodeList(input) {
  const raw = Array.isArray(input) ? input : [input];
  const nodes = [];
  for (const item of raw) {
    if (item == null) continue;
    const parts = String(item)
      .split(/[\n,;]+/)
      .map(normalizeNodeAddress)
      .filter(Boolean);
    nodes.push(...parts);
  }
  return [...new Set(nodes)];
}

async function connectNodeViaRpc(address) {
  try {
    await tajcoinRpc("addnode", [address, "add"]);
    return { address, connected: true };
  } catch (err) {
    return { address, connected: false, error: err.message };
  }
}

async function disconnectNodeViaRpc(address) {
  try {
    await tajcoinRpc("disconnectnode", [address]);
    return { address, disconnected: true };
  } catch (err) {
    return { address, disconnected: false, error: err.message };
  }
}

async function addAddNodes(nodesInput, { connectNow = false } = {}) {
  const nodes = normalizeNodeList(nodesInput).filter(isValidNodeAddress);
  if (!nodes.length) {
    const err = new Error("Aucune adresse de nœud valide (IP ou hostname, port optionnel)");
    err.status = 400;
    throw err;
  }

  const conf = readTajcoinConf();
  if (!conf.exists) {
    const err = new Error("tajcoin.conf introuvable — démarrez tajcoind une première fois ou créez le fichier");
    err.status = 404;
    throw err;
  }

  const merged = [...new Set([...conf.addnodes, ...nodes])];
  const written = writeTajcoinConf({ otherLines: conf.otherLines, addnodes: merged });

  let rpc = [];
  if (connectNow) {
    rpc = await Promise.all(nodes.map((node) => connectNodeViaRpc(node)));
  }

  return {
    path: written.path,
    addnodes: written.addnodes,
    added: nodes,
    rpc,
  };
}

async function removeAddNode(nodeInput, { disconnectNow = false } = {}) {
  const target = normalizeNodeAddress(nodeInput);
  if (!target || !isValidNodeAddress(target)) {
    const err = new Error("Adresse de nœud invalide");
    err.status = 400;
    throw err;
  }

  const conf = readTajcoinConf();
  if (!conf.exists) {
    const err = new Error("tajcoin.conf introuvable");
    err.status = 404;
    throw err;
  }

  const next = conf.addnodes.filter((node) => node !== target);
  if (next.length === conf.addnodes.length) {
    const err = new Error(`Nœud absent de tajcoin.conf : ${target}`);
    err.status = 404;
    throw err;
  }

  const written = writeTajcoinConf({ otherLines: conf.otherLines, addnodes: next });

  let rpc = null;
  if (disconnectNow) {
    rpc = await disconnectNodeViaRpc(target);
  }

  return {
    path: written.path,
    addnodes: written.addnodes,
    removed: target,
    rpc,
  };
}

async function getLivePeerSummary() {
  const status = await getStatus();
  if (!status.online) {
    return { online: false, connections: 0, peers: [] };
  }

  let peers = [];
  try {
    const peerInfo = await tajcoinRpc("getpeerinfo", []);
    if (Array.isArray(peerInfo)) {
      peers = peerInfo.map((peer) => ({
        addr: peer.addr,
        connected: peer.connected !== false,
        inbound: Boolean(peer.inbound),
        subver: peer.subver || null,
      }));
    }
  } catch {
    peers = [];
  }

  return {
    online: true,
    connections: status.connections || 0,
    peers,
  };
}

module.exports = {
  DEFAULT_P2P_PORT,
  resolveTajcoinConfPath,
  normalizeNodeAddress,
  isValidNodeAddress,
  tajcoinNodesStatus,
  listAddNodes,
  addAddNodes,
  removeAddNode,
  getLivePeerSummary,
};
