"use strict";

const fs = require("fs");
const path = require("path");
const { LOCAL_PROFILE } = require("./tajcoin");
const { sendFromAccount } = require("./wallet-accounts");
const { ensureWalletUnlocked, PIN_REWARD_AUTO_PAY } = require("./pin-rewards");
const { computeContentScore, buildContentMetrics } = require("./content-metrics");

const STAKE_ACCOUNT = process.env.STAKE_ACCOUNT || "tajstake";
const STAKE_BASE_APY = Number(process.env.STAKE_BASE_APY || 0.12);
const STAKE_MIN_TAJ = Number(process.env.STAKE_MIN_TAJ || 1);
const STAKE_MAX_YIELD_MULTIPLIER = Number(process.env.STAKE_MAX_YIELD_MULTIPLIER || 3);
const STAKE_SCORE_REFERENCE = Number(process.env.STAKE_SCORE_REFERENCE || 100);

const STAKE_PERIODS = [
  { id: "1m", label: "1 mois", days: 30, multiplier: 1.0 },
  { id: "3m", label: "3 mois", days: 90, multiplier: 1.15 },
  { id: "6m", label: "6 mois", days: 180, multiplier: 1.35 },
  { id: "12m", label: "12 mois", days: 365, multiplier: 1.6 },
];

function defaultStore() {
  return { version: 1, stakes: {} };
}

function stakeKey(stakeId) {
  return String(stakeId || "").trim();
}

function normalizeAddress(address) {
  return String(address || "").trim();
}

function getPeriod(periodId) {
  return STAKE_PERIODS.find((p) => p.id === periodId) || STAKE_PERIODS[0];
}

function scoreFactor(score) {
  const ref = Math.max(1, STAKE_SCORE_REFERENCE);
  return Math.min(1, Math.log10(1 + Math.max(0, score)) / Math.log10(1 + ref));
}

function computeStakeApy({ periodId, scoreAtEnd = 0 }) {
  const period = getPeriod(periodId);
  const factor = 0.4 + 0.6 * scoreFactor(scoreAtEnd);
  return STAKE_BASE_APY * period.multiplier * factor;
}

function computeStakeYield({
  amount,
  periodDays,
  periodId,
  scoreAtStart = 0,
  scoreAtEnd = 0,
}) {
  const principal = Math.max(0, Number(amount) || 0);
  const days = Math.max(1, Number(periodDays) || getPeriod(periodId).days);
  const apy = computeStakeApy({ periodId, scoreAtEnd });
  const scoreDelta = Math.max(0, Number(scoreAtEnd) - Number(scoreAtStart));
  const growthBoost = 1 + scoreDelta / Math.max(10, STAKE_SCORE_REFERENCE / 2);
  const effectiveApy = apy * Math.min(growthBoost, STAKE_MAX_YIELD_MULTIPLIER);
  const yieldTaj = principal * effectiveApy * (days / 365);
  return {
    principal,
    yieldTaj: Number(yieldTaj.toFixed(8)),
    totalPayout: Number((principal + yieldTaj).toFixed(8)),
    apy: Number((effectiveApy * 100).toFixed(4)),
    baseApy: Number((apy * 100).toFixed(4)),
    scoreAtStart,
    scoreAtEnd,
    scoreDelta,
    periodDays: days,
  };
}

function previewStakeYield(stakeInput, metrics, scoreAtStart = 0) {
  const scoreAtEnd = Number(metrics?.score || 0);
  return computeStakeYield({
    amount: stakeInput.amount,
    periodDays: stakeInput.periodDays || getPeriod(stakeInput.periodId).days,
    periodId: stakeInput.periodId,
    scoreAtStart,
    scoreAtEnd,
  });
}

class ContentStakingLedger {
  constructor({ dataDir } = {}) {
    this.storePath = path.join(dataDir, "content-stakes.json");
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

  listByContent(contentCid) {
    return Object.values(this.store.stakes || {}).filter((s) => s.contentCid === contentCid);
  }

  listByStaker(stakerAddress) {
    const key = normalizeAddress(stakerAddress).toLowerCase();
    return Object.values(this.store.stakes || {}).filter(
      (s) => String(s.stakerAddress || "").toLowerCase() === key
    );
  }

  listAll() {
    return Object.values(this.store.stakes || {});
  }

  get(stakeId) {
    return this.store.stakes[stakeKey(stakeId)] || null;
  }

  upsert(stakeId, patch) {
    const id = stakeKey(stakeId);
    this.store.stakes[id] = {
      ...(this.store.stakes[id] || {}),
      stakeId: id,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    return this.publicStake(this.store.stakes[id]);
  }

  publicStake(stake) {
    if (!stake) return null;
    const now = Date.now();
    const endsAt = stake.endsAt ? Date.parse(stake.endsAt) : null;
    const matured = stake.status === "active" && endsAt && now >= endsAt;
    return {
      stakeId: stake.stakeId,
      contentCid: stake.contentCid,
      stakerAddress: stake.stakerAddress,
      amount: Number(stake.amount || 0),
      periodId: stake.periodId,
      periodDays: stake.periodDays,
      status: matured ? "matured" : stake.status,
      paymentTxid: stake.paymentTxid || null,
      scoreAtStart: stake.scoreAtStart ?? null,
      scoreAtEnd: stake.scoreAtEnd ?? null,
      projectedYield: stake.projectedYield || null,
      settledYield: stake.settledYield ?? null,
      settlementTxid: stake.settlementTxid || null,
      startedAt: stake.startedAt || null,
      endsAt: stake.endsAt || null,
      settledAt: stake.settledAt || null,
    };
  }

  activateStake({
    stakeId,
    contentCid,
    stakerAddress,
    amount,
    periodId,
    paymentTxid,
    scoreAtStart = 0,
    projectedYield = null,
  }) {
    const period = getPeriod(periodId);
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + period.days * 24 * 60 * 60 * 1000);
    return this.upsert(stakeId, {
      contentCid,
      stakerAddress: normalizeAddress(stakerAddress),
      amount: Number(amount),
      periodId: period.id,
      periodDays: period.days,
      status: "active",
      paymentTxid,
      scoreAtStart,
      projectedYield,
      startedAt: startedAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
  }

  summaryForContent(contentCid, { contentPool = null, metricsStore = null } = {}) {
    const stakes = this.listByContent(contentCid).filter((s) => s.status === "active" || s.status === "matured");
    const totalStaked = stakes
      .filter((s) => s.status === "active")
      .reduce((sum, s) => sum + Number(s.amount || 0), 0);
    const metrics = buildContentMetrics(contentCid, { contentPool, metricsStore });
    return {
      contentCid,
      metrics,
      activeStakes: stakes.filter((s) => s.status === "active").length,
      totalStaked,
      periods: STAKE_PERIODS,
      minStakeTaj: STAKE_MIN_TAJ,
      baseApyPercent: STAKE_BASE_APY * 100,
    };
  }

  async settleMatured({ contentPool = null, metricsStore = null, rpcProfile = LOCAL_PROFILE } = {}) {
    const results = [];
    for (const stake of Object.values(this.store.stakes || {})) {
      if (stake.status !== "active") continue;
      const endsAt = Date.parse(stake.endsAt || "");
      if (!endsAt || Date.now() < endsAt) continue;

      const metrics = buildContentMetrics(stake.contentCid, { contentPool, metricsStore });
      const settlement = computeStakeYield({
        amount: stake.amount,
        periodDays: stake.periodDays,
        periodId: stake.periodId,
        scoreAtStart: stake.scoreAtStart ?? 0,
        scoreAtEnd: metrics.score,
      });

      let paymentTxid = null;
      if (PIN_REWARD_AUTO_PAY && settlement.totalPayout > 0) {
        await ensureWalletUnlocked(rpcProfile);
        paymentTxid = await sendFromAccount(
          STAKE_ACCOUNT,
          stake.stakerAddress,
          settlement.totalPayout,
          JSON.stringify({
            type: "content-stake-settle",
            stakeId: stake.stakeId,
            contentCid: stake.contentCid,
          }),
          rpcProfile
        );
      }

      this.upsert(stake.stakeId, {
        status: paymentTxid ? "settled" : "matured",
        scoreAtEnd: metrics.score,
        settledYield: settlement.yieldTaj,
        settlement,
        settlementTxid: paymentTxid,
        settledAt: new Date().toISOString(),
      });

      results.push({ stakeId: stake.stakeId, settlement, paymentTxid });
    }
    return results;
  }

  status() {
    const stakes = Object.values(this.store.stakes || {});
    return {
      account: STAKE_ACCOUNT,
      minStakeTaj: STAKE_MIN_TAJ,
      baseApyPercent: STAKE_BASE_APY * 100,
      periods: STAKE_PERIODS,
      totalStakes: stakes.length,
      activeStakes: stakes.filter((s) => s.status === "active").length,
      settledStakes: stakes.filter((s) => s.status === "settled").length,
      totalStakedActive: stakes
        .filter((s) => s.status === "active")
        .reduce((sum, s) => sum + Number(s.amount || 0), 0),
    };
  }
}

module.exports = {
  ContentStakingLedger,
  STAKE_ACCOUNT,
  STAKE_MIN_TAJ,
  STAKE_PERIODS,
  computeStakeApy,
  computeStakeYield,
  previewStakeYield,
  getPeriod,
};
