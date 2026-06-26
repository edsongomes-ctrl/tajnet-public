"use strict";

const { getStatus: getTajcoinStatus } = require("./tajcoin");

const PROTOCOL_SORT = (a, b) => {
  const ba = Number(a.contentMetrics?.boostScore ?? 0);
  const bb = Number(b.contentMetrics?.boostScore ?? 0);
  if (bb !== ba) return bb - ba;
  return (b.blockHeight || 0) - (a.blockHeight || 0);
};

function publicOrigin() {
  return (
    process.env.FUTUREMEN_PUBLIC_ORIGIN ||
    process.env.DISCOVER_NODE_ENDPOINT ||
    "https://tajnet.cloud"
  ).replace(/\/$/, "");
}

function isLocalOrigin(origin) {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return /127\.0\.0\.1|localhost/i.test(origin);
  }
}

function sourceId(label, index, url) {
  try {
    const host = new URL(url).hostname;
    if (host === "127.0.0.1" || host === "localhost") return "local";
    if (host.includes("tajnet.cloud")) return "saopaulo";
  } catch {
    /* ignore */
  }
  const slug = String(label)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `node-${index + 1}`;
}

function labelForUrl(url) {
  try {
    const host = new URL(url).hostname;
    if (host === "127.0.0.1" || host === "localhost") return "localhost";
    if (host.includes("tajnet.cloud")) return "São Paulo";
    return host;
  } catch {
    return url;
  }
}

function isIpv4Host(origin) {
  try {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function preferredLinkOrigin(discover, clientOrigin) {
  const candidates = [
    process.env.FUTUREMEN_PUBLIC_ORIGIN,
    process.env.DISCOVER_NODE_ENDPOINT,
    discover.profile?.endpoint,
    clientOrigin,
  ]
    .filter(Boolean)
    .map((value) => String(value).replace(/\/$/, ""));

  for (const origin of candidates) {
    if (origin.startsWith("https://") && !isLocalOrigin(origin) && !isIpv4Host(origin)) {
      return origin;
    }
  }
  for (const origin of candidates) {
    if (origin.startsWith("https://") && !isLocalOrigin(origin)) {
      return origin;
    }
  }
  return candidates[0] || "http://127.0.0.1:8090";
}

function parseRemoteSources() {
  const raw = process.env.FUTUREMEN_NODE_URLS || "";
  if (!raw.trim()) return [];

  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => {
      const pipe = part.indexOf("|");
      if (pipe !== -1) {
        const url = part.slice(0, pipe).trim().replace(/\/$/, "");
        const label = part.slice(pipe + 1).trim() || labelForUrl(url);
        return { id: sourceId(label, index, url), label, url, remote: true };
      }
      const url = part.replace(/\/$/, "");
      const label = labelForUrl(url);
      return { id: sourceId(label, index, url), label, url, remote: true };
    });
}

function buildFeedSources(discover, localOrigin) {
  const localEndpoint = preferredLinkOrigin(discover, localOrigin);

  const localLabel =
    discover.profile?.name ||
    process.env.DISCOVER_NODE_NAME ||
    labelForUrl(localEndpoint);

  const sources = [
    {
      id: "local",
      label: localLabel,
      url: localEndpoint,
      remote: false,
    },
  ];

  const seen = new Set([localEndpoint]);
  for (const partner of discover.partners?.partners || []) {
    const endpoint = String(partner.endpoint || "").replace(/\/$/, "");
    if (!endpoint || seen.has(endpoint)) continue;
    seen.add(endpoint);
    sources.push({
      id: partner.id || sourceId(partner.name || endpoint, sources.length, endpoint),
      label: partner.name || labelForUrl(endpoint),
      url: endpoint,
      remote: true,
    });
  }

  for (const remote of parseRemoteSources()) {
    const url = remote.url.replace(/\/$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    sources.push({ ...remote, url });
  }

  return sources;
}

function pickCanonicalSource(sources) {
  const pub = publicOrigin();
  if (!sources?.length) return null;
  const byPublic = sources.find((s) => s.nodeOrigin?.replace(/\/$/, "") === pub);
  if (byPublic) return byPublic;
  const httpsPublic = sources.find(
    (s) => s.nodeOrigin?.startsWith("https://") && !isLocalOrigin(s.nodeOrigin)
  );
  if (httpsPublic) return httpsPublic;
  const nonLocal = sources.find((s) => !isLocalOrigin(s.nodeOrigin));
  if (nonLocal) return nonLocal;
  return sources[0];
}

function applyCanonicalLinks(entry) {
  const canonical = pickCanonicalSource(entry.sources);
  if (!canonical) return entry;
  return {
    ...entry,
    txid: canonical.txid || entry.txid,
    contentUrl: canonical.contentUrl || entry.contentUrl,
    publicContentUrl: canonical.publicContentUrl || entry.publicContentUrl,
    ficheUrl: canonical.ficheUrl || entry.ficheUrl,
  };
}

function slimEntry(entry, nodeOrigin, source) {
  const contentCid = entry.contentCid || entry.metadata?.contentCid || null;
  const cvLocked = entry.type === "cv" && entry.cvHasIpfsContent && !entry.cvContentUnlocked;
  const title =
    entry.title || entry.metadata?.title || contentCid || entry.metadataCid || entry.txid || "Sans titre";
  const origin = nodeOrigin.replace(/\/$/, "");
  const gateway = cvLocked
    ? null
    : entry.contentUrl || (contentCid ? `${origin}/ipfs/${contentCid}` : null);
  const fiche =
    entry.type === "cv"
      ? entry.cvFicheUrl ||
        `${origin}/cv?id=${encodeURIComponent(entry.cvProfileId || entry.txid?.slice(0, 16) || entry.txid || contentCid || "")}`
      : entry.txid
        ? `${origin}/view?txid=${encodeURIComponent(entry.txid)}`
        : null;

  return {
    txid: entry.txid || null,
    title,
    type: entry.type || null,
    protocol: entry.protocol || null,
    contentCid: cvLocked ? null : contentCid,
    blockHeight: entry.blockHeight || null,
    blockTime: entry.blockTime || null,
    description: entry.metadata?.description || entry.metadata?.summary || entry.description || null,
    contentUrl: gateway,
    publicContentUrl: cvLocked ? null : entry.publicContentUrl || null,
    ficheUrl: fiche,
    cvContentUnlocked: entry.cvContentUnlocked ?? null,
    cvAccessPrice: entry.cvAccessPrice ?? null,
    contentMetrics: entry.contentMetrics
      ? {
          visits: entry.contentMetrics.visits ?? 0,
          score: entry.contentMetrics.score ?? 0,
          boostScore: entry.contentMetrics.boostScore ?? 0,
        }
      : null,
    contentPool: entry.contentPool
      ? {
          availableTaj: Number(entry.contentPool.availableTaj || 0),
          totalContributed: Number(entry.contentPool.totalContributed || 0),
        }
      : null,
  };
}

function entryDedupeKey(entry) {
  return entry.contentCid || entry.metadata?.contentCid || entry.metadataCid || entry.txid || null;
}

function sourceRef(slim, source) {
  return {
    id: source.id,
    label: source.label,
    nodeOrigin: source.url.replace(/\/$/, ""),
    txid: slim.txid,
    contentUrl: slim.contentUrl,
    publicContentUrl: slim.publicContentUrl,
    ficheUrl: slim.ficheUrl,
    blockHeight: slim.blockHeight,
    contentMetrics: slim.contentMetrics,
  };
}

function mergeEntriesFromSources(sourceResults) {
  const byKey = new Map();

  for (const { source, entries } of sourceResults) {
    for (const entry of entries) {
      const key = entryDedupeKey(entry);
      if (!key) continue;
      const slim = slimEntry(entry, source.url.replace(/\/$/, ""), source);
      const ref = sourceRef(slim, source);

      if (!byKey.has(key)) {
        byKey.set(key, {
          txid: slim.txid,
          title: slim.title,
          type: slim.type,
          protocol: slim.protocol,
          contentCid: slim.contentCid,
          blockHeight: slim.blockHeight,
          blockTime: slim.blockTime,
          description: slim.description,
          contentUrl: slim.contentUrl,
          publicContentUrl: slim.publicContentUrl,
          ficheUrl: slim.ficheUrl,
          contentMetrics: slim.contentMetrics,
          contentPool: slim.contentPool,
          sources: [ref],
        });
        continue;
      }

      const existing = byKey.get(key);
      if (!existing.sources.some((s) => s.id === ref.id)) {
        existing.sources.push(ref);
      }
      const boostNew = Number(slim.contentMetrics?.boostScore ?? 0);
      const boostOld = Number(existing.contentMetrics?.boostScore ?? 0);
      if (boostNew > boostOld) {
        existing.contentMetrics = slim.contentMetrics;
        existing.contentPool = slim.contentPool;
      }
      if ((slim.blockHeight || 0) > (existing.blockHeight || 0)) {
        existing.blockHeight = slim.blockHeight;
        existing.blockTime = slim.blockTime;
      }
    }
  }

  return [...byKey.values()].map(applyCanonicalLinks).sort(PROTOCOL_SORT);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function loadRemoteSource(source) {
  const origin = source.url.replace(/\/$/, "");
  if (origin.startsWith("https://")) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  const [status, data] = await Promise.all([
    fetchJson(`${origin}/api/status`).catch(() => null),
    fetchJson(`${origin}/api/discover/entries?limit=64`),
  ]);
  const entries = (data.entries || []).filter((e) => e.contentCid || e.metadataCid || e.txid);
  return {
    source,
    entries,
    meta: {
      id: source.id,
      label: source.label,
      nodeOrigin: origin,
      nodeName: status?.landing?.nodeName || status?.discover?.nodeName || source.label,
      blockHeight: status?.tajcoin?.blocks ?? status?.tajcoin?.blockHeight ?? null,
      discoverEnabled: Boolean(status?.discover?.enabled),
      entryCount: status?.discover?.entryCount ?? entries.length,
      exportedCount: entries.length,
    },
  };
}

async function loadLocalSource(discover, source, clientOrigin) {
  const origin = source.url.replace(/\/$/, "");
  const listed = await discover.listEntries({ limit: 64, clientOrigin: clientOrigin || origin });
  const entries = (listed.entries || []).filter((e) => e.contentCid || e.metadataCid || e.txid);
  const tajcoin = await getTajcoinStatus();
  const status = discover.status();
  return {
    source,
    entries,
    meta: {
      id: source.id,
      label: source.label,
      nodeOrigin: origin,
      nodeName: status.profile?.name || source.label,
      blockHeight: tajcoin.blocks ?? tajcoin.blockHeight ?? null,
      discoverEnabled: discover.isEnabled(),
      entryCount: status.entryCount ?? entries.length,
      exportedCount: entries.length,
    },
  };
}

async function buildFuturemenFeed(discover, { clientOrigin = null } = {}) {
  const sources = buildFeedSources(discover, clientOrigin);
  const sourceResults = [];
  const sourceMetas = [];

  for (const source of sources) {
    try {
      const loaded = source.remote
        ? await loadRemoteSource(source)
        : await loadLocalSource(discover, source, clientOrigin);
      sourceResults.push(loaded);
      sourceMetas.push(loaded.meta);
    } catch (err) {
      sourceMetas.push({
        id: source.id,
        label: source.label,
        nodeOrigin: source.url.replace(/\/$/, ""),
        error: err.message,
        exportedCount: 0,
      });
    }
  }

  if (!sourceResults.length) {
    throw new Error("Aucune source Discover joignable");
  }

  const merged = mergeEntriesFromSources(sourceResults);
  const pub = publicOrigin();
  const publicMeta =
    sourceMetas.find((s) => s.nodeOrigin?.replace(/\/$/, "") === pub) ||
    sourceMetas.find((s) => s.nodeOrigin?.startsWith("https://") && !isLocalOrigin(s.nodeOrigin)) ||
    sourceMetas.find((s) => !s.error) ||
    sourceMetas[0];

  return {
    version: 2,
    dynamic: true,
    generatedAt: new Date().toISOString(),
    timeline: 2047,
    nodeOrigin: publicMeta?.nodeOrigin || pub,
    publicOrigin: pub,
    nodeName: sourceMetas.map((s) => s.nodeName || s.label).join(" + "),
    blockHeight: Math.max(...sourceMetas.map((s) => Number(s.blockHeight) || 0), 0) || null,
    discoverEnabled: sourceMetas.some((s) => s.discoverEnabled),
    entryCount: merged.length,
    sourceCount: sourceMetas.filter((s) => !s.error).length,
    sources: sourceMetas,
    entries: merged,
  };
}

module.exports = {
  buildFuturemenFeed,
  buildFeedSources,
  publicOrigin,
};
