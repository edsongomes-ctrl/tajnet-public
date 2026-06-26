"use strict";

const fs = require("fs");
const path = require("path");

const SCORE_VISIT_WEIGHT = Number(process.env.CONTENT_SCORE_VISIT_WEIGHT || 2);
const SCORE_PAYER_WEIGHT = Number(process.env.CONTENT_SCORE_PAYER_WEIGHT || 3);
const SCORE_CLAIM_WEIGHT = Number(process.env.CONTENT_SCORE_CLAIM_WEIGHT || 1);

function defaultStore() {
  return { version: 1, contents: {} };
}

function defaultContent(contentCid) {
  return {
    contentCid,
    visits: 0,
    lastVisitAt: null,
    visitSources: {},
    viewers: {},
  };
}

function viewerKey(address) {
  return String(address || "").trim().toLowerCase();
}

function computeContentScore({ visits = 0, payingContributors = 0, claimants = 0 } = {}) {
  return (
    SCORE_VISIT_WEIGHT * Math.max(0, Number(visits) || 0) +
    SCORE_PAYER_WEIGHT * Math.max(0, Number(payingContributors) || 0) +
    SCORE_CLAIM_WEIGHT * Math.max(0, Number(claimants) || 0)
  );
}

/** Ratio score / vues — mise en avant Discover (contenu bien valorisé par rapport à son audience). */
function computeBoostScore({ score = 0, visits = 0 } = {}) {
  const v = Math.max(0, Number(visits) || 0);
  const s = Math.max(0, Number(score) || 0);
  return Number((s / Math.max(1, v)).toFixed(6));
}

function poolPayingContributors(pool) {
  if (!pool?.contributions?.length) return 0;
  const paidSources = new Set(["pin-service", "publisher-escrow", "investor-stake", "promoter-stake"]);
  const payers = new Set();
  for (const row of pool.contributions) {
    if (!paidSources.has(row.source)) continue;
    payers.add(row.payerAddress || row.txid || `${row.source}:${row.at}`);
  }
  return payers.size;
}

function buildContentMetrics(contentCid, { contentPool = null, metricsStore = null } = {}) {
  const pool = contentPool?.getPool(contentCid) || null;
  const local = metricsStore?.get(contentCid) || {};
  const visits = Number(local.visits || 0);
  const payingContributors = pool ? poolPayingContributors(pool) : 0;
  const claimants = Number(pool?.claimCount || 0);
  const score = computeContentScore({ visits, payingContributors, claimants });
  const boostScore = computeBoostScore({ score, visits });

  return {
    contentCid,
    visits,
    payingContributors,
    claimants,
    score,
    boostScore,
    weights: {
      visits: SCORE_VISIT_WEIGHT,
      payingContributors: SCORE_PAYER_WEIGHT,
      claimants: SCORE_CLAIM_WEIGHT,
    },
    totalContributed: Number(pool?.totalContributed || 0),
    totalStaked: Number(pool?.totalStaked || 0),
    lastVisitAt: local.lastVisitAt || null,
  };
}

class ContentMetricsStore {
  constructor({ dataDir } = {}) {
    this.storePath = path.join(dataDir, "content-metrics.json");
    this.store = defaultStore();
  }

  load() {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    try {
      if (fs.existsSync(this.storePath)) {
        this.store = { ...defaultStore(), ...JSON.parse(fs.readFileSync(this.storePath, "utf8")) };
      }
    } catch {
      this.store = defaultStore();
    }
  }

  persist() {
    fs.writeFileSync(this.storePath, `${JSON.stringify(this.store, null, 2)}\n`, "utf8");
  }

  get(contentCid) {
    return this.store.contents[contentCid] || null;
  }

  recordVisit(contentCid, { source = "view" } = {}) {
    if (!contentCid) return null;
    const row = this.store.contents[contentCid] || defaultContent(contentCid);
    row.visits = Number(row.visits || 0) + 1;
    row.lastVisitAt = new Date().toISOString();
    row.visitSources[source] = Number(row.visitSources[source] || 0) + 1;
    if (!row.viewers) row.viewers = {};
    this.store.contents[contentCid] = row;
    this.persist();
    return row;
  }

  recordViewer(contentCid, viewerAddress, { source = "view" } = {}) {
    const address = String(viewerAddress || "").trim();
    if (!contentCid || !address) return null;
    const row = this.store.contents[contentCid] || defaultContent(contentCid);
    if (!row.viewers) row.viewers = {};
    row.viewers[viewerKey(address)] = {
      viewerAddress: address,
      source,
      viewedAt: new Date().toISOString(),
    };
    this.store.contents[contentCid] = row;
    this.persist();
    return row.viewers[viewerKey(address)];
  }

  getViewCount(contentCid) {
    if (!contentCid) return 0;
    return Number(this.store.contents[contentCid]?.visits || 0);
  }

  hasViewer(contentCid, viewerAddress) {
    if (!contentCid || !viewerAddress) return false;
    const row = this.store.contents[contentCid];
    return Boolean(row?.viewers?.[viewerKey(viewerAddress)]);
  }

  status() {
    const contents = Object.values(this.store.contents || {});
    return {
      trackedContents: contents.length,
      totalVisits: contents.reduce((sum, row) => sum + Number(row.visits || 0), 0),
      scoreWeights: {
        visits: SCORE_VISIT_WEIGHT,
        payingContributors: SCORE_PAYER_WEIGHT,
        claimants: SCORE_CLAIM_WEIGHT,
      },
    };
  }
}

module.exports = {
  ContentMetricsStore,
  computeContentScore,
  computeBoostScore,
  buildContentMetrics,
  poolPayingContributors,
  SCORE_VISIT_WEIGHT,
  SCORE_PAYER_WEIGHT,
  SCORE_CLAIM_WEIGHT,
};
