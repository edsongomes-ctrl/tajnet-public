"use strict";

const { decodeOpReturnPayload } = require("./announce");
const {
  bufferToUnicodeText,
  normalizeUnicodeText,
  normalizeDiscoverTextFields,
} = require("./text-encoding");

const CID_PATTERN = /^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|b[a-z2-7]{58,})$/i;

const SUPPORTED_PROTOCOLS = [
  "tajnet-binary",
  "tajnetv1",
  "tajcoin-cid",
  "legacy-pipe",
];

function isValidCid(cid) {
  return Boolean(cid && CID_PATTERN.test(String(cid).trim()));
}

function parseCompactPipe(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("TAJNETv1")) {
    return null;
  }

  const result = {
    protocol: "tajnetv1",
    format: "compact",
    type: "publication",
    tags: [],
    metadata: {},
  };

  for (const part of trimmed.split("|")) {
    const sep = part.indexOf(":");
    if (sep === -1) continue;
    const key = part.slice(0, sep).trim();
    const value = part.slice(sep + 1).trim();
    if (key === "CID") result.cid = value;
    if (key === "TITLE") result.title = normalizeUnicodeText(value);
    if (key === "TS") result.timestamp = Number(value) * 1000;
    if (key === "TAGS") result.tags = value.split(",").map((t) => t.trim()).filter(Boolean);
    if (key === "TYPE") result.type = value;
  }

  return result.cid ? result : null;
}

function parseLegacyPipe(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.includes("CID:") || trimmed.startsWith("TAJNETv1")) {
    return null;
  }

  const result = {
    protocol: "legacy-pipe",
    format: "compact",
    type: "publication",
    tags: [],
    metadata: { source: "futuremen-v0" },
  };

  for (const part of trimmed.split("|")) {
    const sep = part.indexOf(":");
    if (sep === -1) continue;
    const key = part.slice(0, sep).trim();
    const value = part.slice(sep + 1).trim();
    if (key === "CID") result.cid = value;
    if (key === "TITLE") result.title = normalizeUnicodeText(value);
    if (key === "TAGS") result.tags = value.split(",").map((t) => t.trim()).filter(Boolean);
  }

  return result.cid ? result : null;
}

function parseExtendedJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  let data;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (data.protocol === "TAJNETv1" || data.protocol === "tajnetv1") {
    const meta = data.metadata || {};
    return {
      protocol: "tajnetv1",
      format: "json",
      type: data.type || meta.category || "publication",
      cid: data.cid || data.contentCid,
      title: normalizeUnicodeText(data.title || meta.title || null),
      tier: data.tier || "basic",
      timestamp: data.timestamp || null,
      tags: data.tags || meta.tags || [],
      metadata: {
        ...meta,
        source: meta.source || "tajnetv1",
        author: meta.author || null,
        planet: meta.planet || null,
        category: meta.category || null,
        url: meta.url || null,
      },
    };
  }

  if (data.type === "cid-registration" && data.cid) {
    const meta = data.metadata || {};
    return {
      protocol: "tajcoin-cid",
      format: "json",
      type: "cid-registration",
      cid: data.cid,
      title: normalizeUnicodeText(meta.title || data.title || null),
      tier: data.tier || "basic",
      timestamp: data.timestamp || null,
      tags: meta.tags || data.tags || [],
      metadata: {
        ...meta,
        source: "tajcoin.fr",
        description: meta.description || null,
        category: meta.category || "general",
      },
    };
  }

  if (data.protocol === "tajnet" && (data.contentCid || data.cid)) {
    return {
      protocol: "tajnet-binary",
      format: "json-metadata",
      type: data.type || "file",
      cid: data.contentCid || data.cid,
      title: normalizeUnicodeText(data.title || null),
      timestamp: data.timestamp ? Date.parse(data.timestamp) || data.timestamp : null,
      tags: [],
      metadata: data,
    };
  }

  return null;
}

function parseCommentPayload(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const normalized = normalizeUnicodeText(text);
  return (
    parseExtendedJson(normalized) ||
    parseCompactPipe(normalized) ||
    parseLegacyPipe(normalized)
  );
}

function parseOpReturnBuffer(buffer) {
  if (!buffer || !buffer.length) {
    return null;
  }

  const binary = decodeOpReturnPayload(buffer);
  if (binary?.metadataCid) {
    return {
      protocol: "tajnet-binary",
      format: "opreturn-binary",
      type: binary.type || "file",
      cid: null,
      metadataCid: binary.metadataCid,
      title: null,
      tags: [],
      metadata: { source: "tajnet" },
    };
  }

  let text = bufferToUnicodeText(buffer);
  if (!text) {
    return null;
  }

  return parseCommentPayload(text);
}

function mapDiscoverType(parsed) {
  const type = parsed.type || "file";
  if (["page", "file", "cv"].includes(type)) {
    return type;
  }
  if (type === "cid-registration" || type === "publication" || type === "reunion") {
    return "file";
  }
  return type;
}

function toDiscoverEntry(parsed, context = {}) {
  if (!parsed) {
    return null;
  }

  const contentCid = parsed.cid || parsed.contentCid || null;
  if (!contentCid && !parsed.metadataCid) {
    return null;
  }
  if (contentCid && !isValidCid(contentCid)) {
    return null;
  }

  const metadata =
    parsed.metadata && Object.keys(parsed.metadata).length
      ? {
          v: 1,
          protocol: parsed.protocol,
          type: parsed.type,
          contentCid,
          title: parsed.title || null,
          timestamp: parsed.timestamp
            ? new Date(parsed.timestamp).toISOString()
            : null,
          tier: parsed.tier || null,
          tags: parsed.tags || [],
          ...parsed.metadata,
        }
      : null;

  return normalizeDiscoverTextFields({
    txid: context.txid,
    protocol: parsed.protocol,
    format: parsed.format,
    type: mapDiscoverType(parsed),
    rawType: parsed.type || null,
    contentCid,
    metadataCid: parsed.metadataCid || null,
    title: parsed.title || parsed.metadata?.title || contentCid || parsed.metadataCid,
    tier: parsed.tier || null,
    tags: parsed.tags || [],
    blockHeight: context.blockHeight ?? null,
    blockTime: context.blockTime ?? null,
    amount: context.amount ?? null,
    address: context.address ?? null,
    metadata,
    metadataStatus: metadata ? "embedded" : parsed.metadataCid ? "pending" : "resolved",
    source: context.source || "chain",
    discoveredAt: new Date().toISOString(),
  });
}

function protocolsConfig() {
  return {
    supported: SUPPORTED_PROTOCOLS,
    formats: [
      { id: "tajnet-binary", label: "TajNet OP_RETURN (TAJ + CID v0)" },
      { id: "tajnetv1", label: "TAJNETv1 (Futuremen / standard unifié)" },
      { id: "tajcoin-cid", label: "Tajcoin MVP (cid-registration JSON)" },
      { id: "legacy-pipe", label: "Futuremen v0 (CID:|TITLE:|TAGS:)" },
    ],
    detection: [
      "OP_RETURN binaire 0x54414a (TAJ)",
      "OP_RETURN / commentaire JSON TAJNETv1 ou cid-registration",
      "Commentaire wallet pipe TAJNETv1 ou legacy",
    ],
  };
}

module.exports = {
  SUPPORTED_PROTOCOLS,
  CID_PATTERN,
  isValidCid,
  parseCommentPayload,
  parseCompactPipe,
  parseLegacyPipe,
  parseExtendedJson,
  parseOpReturnBuffer,
  toDiscoverEntry,
  protocolsConfig,
};
