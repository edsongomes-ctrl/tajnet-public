"use strict";

const fs = require("fs");
const path = require("path");
const { LOCAL_PROFILE, tajcoinRpc } = require("./tajcoin");
const {
  parseCommentPayload,
  parseOpReturnBuffer,
  toDiscoverEntry,
  protocolsConfig,
} = require("./cid-protocols");
const { fetchIpfsJson, IPFS_GATEWAY_URL, pinCidWithFallback, getIpfsStatus } = require("./ipfs");
const { buildClientIpfsUrls, clientGatewayBase } = require("./ipfs-gateway");
const { settlePinReward, requestRemoteSettlement } = require("./pin-rewards");
const { PIN_REWARD_PER_CLAIM } = require("./content-pool");
const { buildContentMetrics } = require("./content-metrics");
const { checkOpportunistClaimEligibility } = require("./opportunist-claim");
const { gateCvDiscoverEntry } = require("./cv-discover-gate");
const {
  bufferToUnicodeText,
  normalizeUnicodeText,
  normalizeDiscoverTextFields,
} = require("./text-encoding");

const PIN_CLAIM_ACCOUNT = process.env.PIN_ACCOUNT || "tajpin";

const DISCOVER_ENABLED = process.env.DISCOVER_ENABLED === "true";
const DISCOVER_SCAN_INTERVAL_MS = Number(process.env.DISCOVER_SCAN_INTERVAL_MS || 60_000);
const DISCOVER_BLOCKS_PER_SCAN = Number(process.env.DISCOVER_BLOCKS_PER_SCAN || 120);
const DISCOVER_LOOKBACK_BLOCKS = Number(process.env.DISCOVER_LOOKBACK_BLOCKS || 5000);
const DISCOVER_FETCH_METADATA = process.env.DISCOVER_FETCH_METADATA !== "false";
const DISCOVER_WALLET_SCAN = process.env.DISCOVER_WALLET_SCAN !== "false";
const DISCOVER_WALLET_TX_LIMIT = Number(process.env.DISCOVER_WALLET_TX_LIMIT || 5000);

function isStubMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return true;
  }
  if (metadata.contentCid || metadata.fileCid || metadata.cid) {
    return false;
  }
  if (metadata.title || metadata.publisherAddress || metadata.author) {
    return false;
  }
  if (metadata.pinRewardTaj != null && Number(metadata.pinRewardTaj) > 0) {
    return false;
  }
  return metadata.source === "tajnet" || metadata.protocol === "tajnet-binary";
}

function extractOpReturnData(scriptHex) {
  if (!scriptHex) return null;
  const script = Buffer.from(scriptHex, "hex");
  if (!script.length || script[0] !== 0x6a) {
    return null;
  }

  let offset = 1;
  let dataLen = 0;

  if (script[offset] <= 75) {
    dataLen = script[offset];
    offset += 1;
  } else if (script[offset] === 0x4c && script.length > offset + 1) {
    offset += 1;
    dataLen = script[offset];
    offset += 1;
  } else {
    return null;
  }

  if (offset + dataLen > script.length) {
    return null;
  }

  return script.subarray(offset, offset + dataLen);
}

function defaultIndex() {
  return {
    version: 1,
    enabled: DISCOVER_ENABLED,
    lastScannedHeight: null,
    lastScanAt: null,
    lastScanError: null,
    entries: {},
  };
}

function defaultProfile() {
  return {
    public: false,
    name: process.env.DISCOVER_NODE_NAME || "TajNode local",
    endpoint: process.env.DISCOVER_NODE_ENDPOINT || "",
    pinPriceTaj: Number(process.env.DISCOVER_PIN_PRICE_TAJ || 0.5),
    uptimeScore: 100,
  };
}

function defaultPins() {
  return { version: 1, pins: {} };
}

function defaultPartners() {
  return { partners: [] };
}

class DiscoverIndexer {
  constructor({ dataDir } = {}) {
    this.dataDir = dataDir;
    this.indexPath = path.join(dataDir, "index.json");
    this.profilePath = path.join(dataDir, "profile.json");
    this.partnersPath = path.join(dataDir, "partners.json");
    this.pinsPath = path.join(dataDir, "pins.json");
    this.index = defaultIndex();
    this.profile = defaultProfile();
    this.partners = defaultPartners();
    this.pins = defaultPins();
    this.rewardLedger = null;
    this.contentPool = null;
    this.metricsStore = null;
    this.cvIndex = null;
    this.cvAccess = null;
    this.scanTimer = null;
    this.scanning = false;
  }

  setCvGate({ cvIndex, cvAccess } = {}) {
    this.cvIndex = cvIndex || null;
    this.cvAccess = cvAccess || null;
  }

  isEnabled() {
    return Boolean(this.index.enabled);
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.index = this.readJson(this.indexPath, defaultIndex());
    this.profile = this.readJson(this.profilePath, defaultProfile());
    this.partners = this.readJson(this.partnersPath, defaultPartners());
    this.pins = this.readJson(this.pinsPath, defaultPins());
    if (DISCOVER_ENABLED && !this.index.enabled) {
      this.index.enabled = true;
    }
  }

  persistIndex() {
    this.writeJson(this.indexPath, this.index);
  }

  persistProfile() {
    this.writeJson(this.profilePath, this.profile);
  }

  persistPartners() {
    this.writeJson(this.partnersPath, this.partners);
  }

  persistPins() {
    this.writeJson(this.pinsPath, this.pins);
  }

  setRewardLedger(ledger) {
    this.rewardLedger = ledger;
  }

  setContentPool(contentPool) {
    this.contentPool = contentPool;
  }

  setMetricsStore(metricsStore) {
    this.metricsStore = metricsStore;
  }

  setStakingLedger(stakingLedger) {
    this.stakingLedger = stakingLedger;
  }

  attachContentPool(entry, claimAddress = null) {
    if (!entry?.contentCid || !this.contentPool) {
      return entry;
    }
    const pool = this.contentPool.getPool(entry.contentCid);
    entry.contentPool = pool;
    if (claimAddress) {
      entry.poolClaimedByMe = this.contentPool.hasClaimed(entry.contentCid, claimAddress);
    }
    return entry;
  }

  applyMetadataEconomics(entry) {
    const meta = entry.metadata;
    if (!meta) {
      return entry;
    }
    if (meta.pinRewardTaj != null) {
      entry.pinRewardTaj = Math.max(0, Number(meta.pinRewardTaj) || 0);
    }
    entry.publisherAddress = meta.publisherAddress || meta.author || entry.publisherAddress || null;
    entry.rewardEscrowAddress = meta.rewardEscrowAddress || entry.rewardEscrowAddress || null;
    entry.publisherEndpoint = meta.publisherEndpoint || entry.publisherEndpoint || null;
    return entry;
  }

  getLocalPin(contentCid) {
    if (!contentCid) return null;
    return this.pins.pins?.[contentCid] || null;
  }

  async recordPin({
    contentCid,
    title = null,
    sourceTxid = null,
    paid = false,
    amount = 0,
    paymentTxid = null,
    paymentAddress = null,
    claim = null,
  }) {
    if (!contentCid) {
      throw new Error("contentCid requis");
    }

    const record = {
      contentCid,
      title: normalizeUnicodeText(title),
      sourceTxid,
      paid,
      amount,
      paymentTxid,
      paymentAddress,
      claim,
      pinnedAt: new Date().toISOString(),
    };

    this.pins.pins[contentCid] = record;
    this.persistPins();
    return record;
  }

  listPins({ limit = 50, offset = 0 } = {}) {
    const pins = Object.values(this.pins.pins || {});
    pins.sort((a, b) => String(b.pinnedAt).localeCompare(String(a.pinnedAt)));
    const total = pins.length;
    const slice = pins.slice(offset, offset + limit).map((pin) => ({
      ...pin,
      title: normalizeUnicodeText(pin.title),
    }));
    return { total, pins: slice, offset, limit };
  }

  async createRewardClaim(entry) {
    if (!entry.pinRewardTaj || entry.pinRewardTaj <= 0) {
      return null;
    }
    const claimAddress = await tajcoinRpc("getnewaddress", [PIN_CLAIM_ACCOUNT], LOCAL_PROFILE);
    return {
      pinRewardTaj: entry.pinRewardTaj,
      publisherAddress: entry.publisherAddress || null,
      claimAddress,
      status: "awaiting_payment",
      createdAt: new Date().toISOString(),
    };
  }

  async pinDiscoverEntry(txid) {
    let entry = this.getEntry(txid);
    if (!entry) {
      throw new Error("Entrée Discover introuvable");
    }
    entry = await this.enrichEntry(entry);
    this.applyMetadataEconomics(entry);
    this.index.entries[txid] = entry;
    this.persistIndex();

    const contentCid = entry.contentCid;
    if (!contentCid) {
      throw new Error("Aucun CID contenu à épingler");
    }

    const alreadyPinned = Boolean(this.getLocalPin(contentCid));
    if (!alreadyPinned) {
      await pinCidWithFallback(contentCid);
    }

    const pin = alreadyPinned
      ? this.getLocalPin(contentCid)
      : await this.recordPin({
          contentCid,
          title: entry.title,
          sourceTxid: txid,
          paid: false,
          amount: 0,
          claim: null,
        });

    return {
      alreadyPinned,
      pin,
      entry: this.attachContentPool({ ...entry }),
      contentPool: this.contentPool?.getPool(contentCid) || null,
    };
  }

  attestContentView(txid, viewerAddress) {
    const entry = this.getEntry(txid);
    if (!entry?.contentCid) {
      throw new Error("Entrée ou CID introuvable");
    }
    if (!this.getLocalPin(entry.contentCid)) {
      throw new Error("Contenu non épinglé sur ce nœud — un contributeur (don pinning) doit financer l'épinglage avant réclamation");
    }
    if (!this.metricsStore) {
      throw new Error("Métriques indisponibles sur ce nœud");
    }
    this.metricsStore.recordViewer(entry.contentCid, viewerAddress, { source: "discover" });
    return {
      contentCid: entry.contentCid,
      txid,
      viewed: true,
      eligibility: this.getClaimEligibility(entry.contentCid, viewerAddress),
    };
  }

  getClaimEligibility(contentCid, claimAddress) {
    return checkOpportunistClaimEligibility(contentCid, claimAddress, {
      discover: this,
      metricsStore: this.metricsStore,
      contentPool: this.contentPool,
    });
  }

  async claimDiscoverReward(txid, claimAddress) {
    let entry = this.getEntry(txid);
    if (!entry) {
      throw new Error("Entrée Discover introuvable");
    }
    entry = await this.enrichEntry(entry);
    this.applyMetadataEconomics(entry);

    const eligibility = this.getClaimEligibility(entry.contentCid, claimAddress);
    if (!eligibility.eligible) {
      return {
        status: "ineligible",
        error: eligibility.reason,
        eligibility,
        entry,
      };
    }

    const claim = {
      claimAddress,
      pinRewardTaj: PIN_REWARD_PER_CLAIM,
    };

    let settlement = await settlePinReward(
      { entry, claim },
      this.rewardLedger,
      this.contentPool,
      undefined,
      this.stakingLedger
    );
    if (settlement.status !== "paid" && settlement.status !== "already_claimed") {
      const remote = await requestRemoteSettlement(entry, claim);
      if (remote?.status === "paid" || remote?.paymentTxid) {
        settlement = { ...settlement, ...remote };
      }
    }

    return {
      status: settlement.status,
      settlement,
      eligibility: this.getClaimEligibility(entry.contentCid, claimAddress),
      entry,
      contentPool: this.contentPool?.getPool(entry.contentCid) || null,
    };
  }

  readJson(filePath, fallback) {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      return { ...fallback, ...JSON.parse(fs.readFileSync(filePath, "utf8")) };
    } catch {
      return fallback;
    }
  }

  writeJson(filePath, data) {
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  status() {
    const entries = Object.values(this.index.entries || {});
    const protocolCounts = {};
    for (const entry of entries) {
      const key = entry.protocol || "unknown";
      protocolCounts[key] = (protocolCounts[key] || 0) + 1;
    }
    return {
      enabled: this.isEnabled(),
      scanning: this.scanning,
      lastScannedHeight: this.index.lastScannedHeight,
      lastScanAt: this.index.lastScanAt,
      lastWalletScanAt: this.index.lastWalletScanAt || null,
      lastScanError: this.index.lastScanError,
      entryCount: entries.length,
      pinCount: Object.keys(this.pins.pins || {}).length,
      protocolCounts,
      blocksPerScan: DISCOVER_BLOCKS_PER_SCAN,
      lookbackBlocks: DISCOVER_LOOKBACK_BLOCKS,
      fetchMetadata: DISCOVER_FETCH_METADATA,
      walletScan: DISCOVER_WALLET_SCAN,
      walletTxLimit: DISCOVER_WALLET_TX_LIMIT,
      protocols: protocolsConfig(),
      profile: {
        public: Boolean(this.profile.public),
        name: this.profile.name,
        endpoint: this.profile.endpoint,
        pinPriceTaj: this.profile.pinPriceTaj,
        uptimeScore: this.profile.uptimeScore,
      },
      publicProfile: this.publicProfile(),
      gateway: IPFS_GATEWAY_URL,
    };
  }

  publicProfile() {
    if (!this.isEnabled() || !this.profile.public) {
      return { public: false };
    }
    return {
      public: true,
      name: this.profile.name,
      endpoint: this.profile.endpoint,
      pinPriceTaj: this.profile.pinPriceTaj,
      uptimeScore: this.profile.uptimeScore,
    };
  }

  listNodes() {
    const nodes = [];
    const local = this.publicProfile();
    if (local.public) {
      nodes.push({ id: "local", ...local, source: "local" });
    }
    for (const partner of this.partners.partners || []) {
      nodes.push({ ...partner, source: "partner" });
    }
    return nodes;
  }

  setEnabled(enabled) {
    this.index.enabled = Boolean(enabled);
    this.persistIndex();
    if (enabled) {
      this.startPolling();
      this.scan({ force: true }).catch(() => {});
    } else {
      this.stopPolling();
    }
    return this.status();
  }

  updateProfile(patch = {}) {
    const next = { ...this.profile, ...patch };
    if (next.pinPriceTaj != null) {
      next.pinPriceTaj = Math.max(0, Number(next.pinPriceTaj) || 0);
    }
    if (next.uptimeScore != null) {
      next.uptimeScore = Math.min(100, Math.max(0, Number(next.uptimeScore) || 0));
    }
    this.profile = next;
    this.persistProfile();
    return this.publicProfile();
  }

  addPartner(partner) {
    const entry = {
      id: partner.id || `partner_${Date.now()}`,
      name: partner.name || "TajNode partenaire",
      endpoint: partner.endpoint,
      pinPriceTaj: Number(partner.pinPriceTaj || 0),
      uptimeScore: Number(partner.uptimeScore || 0),
      addedAt: new Date().toISOString(),
    };
    if (!entry.endpoint) {
      throw new Error("endpoint requis");
    }
    this.partners.partners = [...(this.partners.partners || []), entry];
    this.persistPartners();
    return entry;
  }

  removePartner(id) {
    this.partners.partners = (this.partners.partners || []).filter((p) => p.id !== id);
    this.persistPartners();
  }

  async reenrichIfNeeded(entry) {
    if (!entry?.metadataCid) {
      return entry;
    }
    if (entry.metadataStatus === "resolved" && entry.contentCid) {
      return entry;
    }
    if (
      entry.metadataStatus === "embedded" &&
      !isStubMetadata(entry.metadata) &&
      entry.contentCid
    ) {
      return entry;
    }
    return this.enrichEntry(entry);
  }

  enrichEntryForClient(entry, { clientOrigin = null, claimAddress = null } = {}) {
    const enriched = normalizeDiscoverTextFields(this.applyMetadataEconomics({ ...entry }));
    const localPin = this.getLocalPin(enriched.contentCid);
    const contentUrls = enriched.contentCid ? buildClientIpfsUrls(enriched.contentCid, clientOrigin) : {};
    const metadataUrls = enriched.metadataCid ? buildClientIpfsUrls(enriched.metadataCid, clientOrigin) : {};
    const row = {
      ...enriched,
      localPinned: Boolean(localPin),
      localPin,
      contentUrl: contentUrls.gatewayUrl,
      publicContentUrl: contentUrls.publicGatewayUrl,
      metadataUrl: metadataUrls.gatewayUrl,
      publicMetadataUrl: metadataUrls.publicGatewayUrl,
      contentPool: this.contentPool?.getPool(enriched.contentCid) || null,
      contentMetrics: enriched.contentCid
        ? buildContentMetrics(enriched.contentCid, {
            contentPool: this.contentPool,
            metricsStore: this.metricsStore,
          })
        : null,
      claimEligibility:
        claimAddress && enriched.contentCid
          ? this.getClaimEligibility(enriched.contentCid, claimAddress)
          : null,
    };
    return gateCvDiscoverEntry(row, {
      cvIndex: this.cvIndex,
      cvAccess: this.cvAccess,
      claimAddress,
    });
  }

  async listEntries({ q = "", type = "", protocol = "", limit = 50, offset = 0, clientOrigin = null, claimAddress = null } = {}) {
    let entries = Object.values(this.index.entries || {});

    if (type) {
      entries = entries.filter((entry) => entry.type === type);
    }

    if (protocol) {
      entries = entries.filter((entry) => entry.protocol === protocol);
    }

    const query = String(q || "").trim().toLowerCase();
    if (query) {
      entries = entries.filter((entry) => {
        const haystack = [
          entry.txid,
          entry.metadataCid,
          entry.contentCid,
          entry.title,
          entry.type,
          entry.protocol,
          entry.rawType,
          ...(entry.tags || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      });
    }

    const total = entries.length;
    entries.sort((a, b) => {
      const scoreEntry = (entry) => {
        const pool = this.contentPool?.getPool(entry.contentCid);
        const per = Number(pool?.rewardPerClaim || 0.5);
        const available = Number(pool?.availableTaj || 0);
        const canClaim = pool && available + 1e-8 >= per;
        const pinned = Boolean(this.getLocalPin(entry.contentCid));
        if (pinned && canClaim) return 900;
        if (canClaim) return 800;
        if (pool && Number(pool.totalContributed) > 0) return 700;
        if (Number(entry.pinRewardTaj) > 0) return 600;
        return 0;
      };
      const boostEntry = (entry) => {
        if (!entry.contentCid) return 0;
        return (
          buildContentMetrics(entry.contentCid, {
            contentPool: this.contentPool,
            metricsStore: this.metricsStore,
          }).boostScore || 0
        );
      };
      const diff = scoreEntry(b) - scoreEntry(a);
      if (diff !== 0) return diff;
      const boostDiff = boostEntry(b) - boostEntry(a);
      if (boostDiff !== 0) return boostDiff;
      return (b.blockHeight || 0) - (a.blockHeight || 0);
    });
    const page = entries.slice(offset, offset + limit);
    let indexChanged = false;
    for (const entry of page) {
      if (
        !entry.metadataCid ||
        (entry.metadataStatus === "resolved" && entry.contentCid && !isStubMetadata(entry.metadata))
      ) {
        continue;
      }
      const before = entry.metadataStatus;
      await this.reenrichIfNeeded(entry);
      if (entry.metadataStatus !== before) {
        this.index.entries[entry.txid] = entry;
        indexChanged = true;
      }
    }
    if (indexChanged) {
      this.persistIndex();
    }

    const slice = page.map((entry) =>
      this.enrichEntryForClient(entry, { clientOrigin, claimAddress })
    );
    return {
      total,
      entries: slice,
      offset,
      limit,
      gateway: clientGatewayBase(clientOrigin),
      publicGateway: clientGatewayBase(null),
    };
  }

  getEntry(txid) {
    return this.index.entries?.[txid] || null;
  }

  async ingestLocalAnnouncement(announce, context = {}) {
    if (!announce || announce.status !== "broadcast") {
      return null;
    }

    const entry = {
      txid: announce.txid,
      protocol: "tajnet-binary",
      format: "local",
      type: announce.type,
      metadataCid: announce.metadataCid,
      contentCid: announce.contentCid,
      title: announce.metadata?.title || context.title || null,
      blockHeight: context.blockHeight || null,
      blockTime: context.blockTime || Math.floor(Date.now() / 1000),
      metadata: announce.metadata || null,
      metadataStatus: announce.metadata ? "embedded" : "pending",
      pinRewardTaj: announce.metadata?.pinRewardTaj ?? null,
      publisherAddress: announce.metadata?.publisherAddress || announce.metadata?.author || null,
      source: "local",
      discoveredAt: new Date().toISOString(),
    };

    this.index.entries[entry.txid] = entry;
    this.persistIndex();
    return entry;
  }

  async enrichEntry(entry) {
    const stubEmbedded = entry.metadataStatus === "embedded" && isStubMetadata(entry.metadata);

    if (entry.metadata && entry.metadataStatus === "embedded" && !stubEmbedded) {
      if (!entry.contentCid) {
        entry.contentCid =
          entry.metadata.contentCid || entry.metadata.fileCid || entry.metadata.cid || null;
      }
      if (!entry.title && entry.metadata.title) {
        entry.title = entry.metadata.title;
      }
      return normalizeDiscoverTextFields(this.applyMetadataEconomics(entry));
    }

    if (!DISCOVER_FETCH_METADATA || !entry.metadataCid) {
      if (entry.contentCid && entry.title) {
        entry.metadataStatus = entry.metadataStatus || "resolved";
      }
      return entry;
    }
    if (entry.metadataStatus === "resolved" && entry.contentCid && !stubEmbedded) {
      return entry;
    }

    try {
      const metadata = await fetchIpfsJson(entry.metadataCid);
      entry.metadata = metadata;
      entry.contentCid = metadata.contentCid || metadata.fileCid || metadata.cid || entry.contentCid;
      entry.title = metadata.title || entry.title;
      entry.type = metadata.type || entry.type;
      entry.metadataStatus = "resolved";
      this.applyMetadataEconomics(entry);
    } catch (err) {
      entry.metadataStatus = "unavailable";
      entry.metadataError = err.message;
    }

    return normalizeDiscoverTextFields(entry);
  }

  async extractOpReturnTextFromTx(txid, rpcProfile = LOCAL_PROFILE) {
    try {
      let tx;
      try {
        tx = await tajcoinRpc("getrawtransaction", [txid, true], rpcProfile);
      } catch {
        const hex = await tajcoinRpc("getrawtransaction", [txid], rpcProfile);
        tx = await tajcoinRpc("decoderawtransaction", [hex], rpcProfile);
      }

      for (const output of tx.vout || []) {
        const script = output.scriptPubKey || {};
        const isNullData =
          script.type === "nulldata" ||
          String(script.asm || "").startsWith("OP_RETURN");
        if (!isNullData) continue;
        const payload = extractOpReturnData(script.hex);
        if (!payload) continue;
        const text = bufferToUnicodeText(payload);
        if (text) return text;
      }
    } catch {
      // ignore
    }
    return "";
  }

  async resolveTxComment(tx, rpcProfile = LOCAL_PROFILE) {
    let comment = tx.comment || "";
    if (comment || !tx.txid) {
      return comment;
    }

    try {
      const details = await tajcoinRpc("gettransaction", [tx.txid], rpcProfile);
      comment = details.comment || "";
      if (!comment && Array.isArray(details.details)) {
        for (const detail of details.details) {
          if (detail.comment) {
            comment = detail.comment;
            break;
          }
        }
      }
    } catch {
      comment = "";
    }

    if (!comment) {
      comment = await this.extractOpReturnTextFromTx(tx.txid, rpcProfile);
    }

    return normalizeUnicodeText(comment);
  }

  ingestEntry(entry) {
    if (!entry?.txid || this.index.entries[entry.txid]) {
      return false;
    }
    this.index.entries[entry.txid] = entry;
    return true;
  }

  async ingestParsedAnnouncement(parsed, context = {}) {
    const entry = toDiscoverEntry(parsed, context);
    if (!entry) {
      return null;
    }
    if (this.index.entries[entry.txid]) {
      return this.index.entries[entry.txid];
    }
    const enriched = await this.enrichEntry(entry);
    this.index.entries[entry.txid] = enriched;
    return enriched;
  }

  importRegistryEntries(items = [], source = "registry-import") {
    let imported = 0;
    for (const item of items) {
      const parsed =
        parseCommentPayload(
          typeof item === "string"
            ? item
            : item.protocol === "TAJNETv1"
              ? JSON.stringify(item)
              : item.type === "cid-registration"
                ? JSON.stringify(item)
                : item.cid
                  ? `TAJNETv1|CID:${item.cid}|TITLE:${item.title || ""}|TS:${Math.floor((item.time || Date.now()) / 1000)}|TAGS:${(item.tags || []).join(",")}`
                  : null
        ) ||
        (item.cid
          ? {
              protocol: item.protocol === "TAJNETv1" ? "tajnetv1" : "legacy-pipe",
              format: "registry",
              type: item.category || item.type || "publication",
              cid: item.cid,
              title: item.title || null,
              tier: item.tier || "basic",
              timestamp: item.time ? item.time * 1000 : item.timestamp || null,
              tags: item.tags || [],
              metadata: {
                planet: item.planet || null,
                category: item.category || null,
                source,
              },
            }
          : null);

      if (!parsed) continue;

      const txid = item.txid || `import_${parsed.cid}_${item.time || Date.now()}`;
      const entry = toDiscoverEntry(parsed, {
        txid,
        blockTime: item.time || null,
        amount: item.amount || null,
        source,
      });
      if (!entry) continue;
      if (this.ingestEntry(entry)) {
        imported += 1;
      }
    }
    if (imported) {
      this.persistIndex();
    }
    return imported;
  }

  async parseBlockTransactions(block) {
    const found = [];
    const txs = block.tx || [];

    for (const tx of txs) {
      if (!tx || typeof tx === "string") continue;

      for (const output of tx.vout || []) {
        const script = output.scriptPubKey || {};
        const isNullData =
          script.type === "nulldata" ||
          String(script.asm || "").startsWith("OP_RETURN");

        if (!isNullData) continue;

        const payload = extractOpReturnData(script.hex);
        if (!payload) continue;

        const parsed = parseOpReturnBuffer(payload);
        const entry = toDiscoverEntry(parsed, {
          txid: tx.txid,
          blockHeight: block.height,
          blockTime: block.time,
          source: "chain",
        });
        if (entry) {
          found.push(entry);
        }
      }
    }

    return found;
  }

  async scanWalletTransactions(rpcProfile = LOCAL_PROFILE) {
    if (!DISCOVER_WALLET_SCAN) {
      return { skipped: true, reason: "Scan wallet désactivé" };
    }

    const txs = await tajcoinRpc(
      "listtransactions",
      ["*", DISCOVER_WALLET_TX_LIMIT],
      rpcProfile
    );
    let newEntries = 0;

    for (const tx of txs || []) {
      if (!tx?.txid) continue;

      const comment = await this.resolveTxComment(tx, rpcProfile);
      if (!comment) continue;

      const parsed = parseCommentPayload(comment);
      if (!parsed) continue;

      const before = Object.keys(this.index.entries).length;
      await this.ingestParsedAnnouncement(parsed, {
        txid: tx.txid,
        blockTime: tx.blocktime || tx.time || null,
        amount: tx.amount || null,
        address: tx.address || null,
        source: "wallet",
      });
      const after = Object.keys(this.index.entries).length;
      if (after > before) {
        newEntries += 1;
      }
    }

    this.index.lastWalletScanAt = new Date().toISOString();
    this.persistIndex();

    return {
      scannedTxs: (txs || []).length,
      newEntries,
    };
  }

  async scanBlockHeight(height, rpcProfile = LOCAL_PROFILE) {
    const block = await tajcoinRpc("getblockbynumber", [height, true], rpcProfile);
    const parsed = await this.parseBlockTransactions(block);

    for (const entry of parsed) {
      const existing = this.index.entries[entry.txid];
      if (existing) {
        const enriched = await this.reenrichIfNeeded(existing);
        if (enriched.metadataStatus !== existing.metadataStatus) {
          this.index.entries[entry.txid] = enriched;
        }
        continue;
      }
      const enriched = await this.enrichEntry(entry);
      this.index.entries[entry.txid] = enriched;
    }

    return parsed.length;
  }

  async scan({ force = false, rpcProfile = LOCAL_PROFILE } = {}) {
    if (!this.isEnabled() && !force) {
      return { skipped: true, reason: "Discover désactivé" };
    }
    if (this.scanning) {
      return { skipped: true, reason: "Scan déjà en cours" };
    }

    this.scanning = true;
    let scannedBlocks = 0;
    let newEntries = 0;

    try {
      const tip = await tajcoinRpc("getblockcount", [], rpcProfile);
      let fromHeight = this.index.lastScannedHeight;

      if (fromHeight == null) {
        fromHeight = Math.max(0, tip - DISCOVER_LOOKBACK_BLOCKS);
      } else {
        fromHeight += 1;
      }

      if (fromHeight > tip) {
        this.index.lastScanAt = new Date().toISOString();
        this.index.lastScanError = null;
        let walletScan = null;
        if (DISCOVER_WALLET_SCAN) {
          walletScan = await this.scanWalletTransactions(rpcProfile);
        }
        this.persistIndex();
        return {
          scannedBlocks: 0,
          newEntries: walletScan?.newEntries || 0,
          walletScan,
          tip,
          fromHeight,
          toHeight: tip,
        };
      }

      const toHeight = Math.min(tip, fromHeight + DISCOVER_BLOCKS_PER_SCAN - 1);

      for (let height = fromHeight; height <= toHeight; height += 1) {
        const before = Object.keys(this.index.entries).length;
        await this.scanBlockHeight(height, rpcProfile);
        const after = Object.keys(this.index.entries).length;
        newEntries += Math.max(0, after - before);
        scannedBlocks += 1;
      }

      this.index.lastScannedHeight = toHeight;
      this.index.lastScanAt = new Date().toISOString();
      this.index.lastScanError = null;
      this.persistIndex();

      let walletScan = null;
      if (DISCOVER_WALLET_SCAN && toHeight >= tip) {
        walletScan = await this.scanWalletTransactions(rpcProfile);
        newEntries += walletScan.newEntries || 0;
      }

      return {
        scannedBlocks,
        newEntries,
        walletScan,
        tip,
        fromHeight,
        toHeight,
        remaining: Math.max(0, tip - toHeight),
      };
    } catch (err) {
      this.index.lastScanError = err.message;
      this.index.lastScanAt = new Date().toISOString();
      this.persistIndex();
      throw err;
    } finally {
      this.scanning = false;
    }
  }

  startPolling() {
    this.stopPolling();
    if (!this.isEnabled()) return;

    this.scanTimer = setInterval(() => {
      this.scan().catch((err) => {
        this.index.lastScanError = err.message;
        this.persistIndex();
      });
    }, DISCOVER_SCAN_INTERVAL_MS);

    if (typeof this.scanTimer.unref === "function") {
      this.scanTimer.unref();
    }
  }

  stopPolling() {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  async restoreLocalPins() {
    const pins = Object.values(this.pins.pins || {});
    if (!pins.length) {
      return { total: 0, restored: 0, failed: 0, skipped: 0 };
    }

    const ipfs = await getIpfsStatus();
    if (!ipfs.online) {
      console.warn("⚠️  Discover — re-pin ignoré (IPFS offline)");
      return { total: pins.length, restored: 0, failed: 0, skipped: pins.length };
    }

    let restored = 0;
    let failed = 0;
    for (const pin of pins) {
      const cid = pin.contentCid;
      if (!cid) continue;
      try {
        await pinCidWithFallback(cid);
        restored += 1;
      } catch (err) {
        failed += 1;
        console.warn(`⚠️  Re-pin ${cid} échoué — ${err.message}`);
      }
    }

    return { total: pins.length, restored, failed, skipped: 0 };
  }

  init() {
    this.load();
    return this.restoreLocalPins().then((restore) => {
      if (restore.total > 0) {
        const suffix = restore.failed ? ` (${restore.failed} échec(s))` : "";
        console.log(`📌 Discover — ${restore.restored}/${restore.total} pin(s) IPFS restauré(s)${suffix}`);
      }
      if (this.isEnabled()) {
        this.startPolling();
        this.scan({ force: true }).catch(() => {});
      }
      return this.status();
    });
  }

  shutdown() {
    this.stopPolling();
  }
}

module.exports = { DiscoverIndexer, extractOpReturnData, isStubMetadata };
