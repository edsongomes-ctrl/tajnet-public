"use strict";

const crypto = require("crypto");
const { tajcoinRpc, LOCAL_PROFILE } = require("./tajcoin");
const { STAKE_MIN_TAJ, getPeriod, previewStakeYield } = require("./content-staking");
const { buildContentMetrics } = require("./content-metrics");

const STAKE_ACCOUNT = process.env.STAKE_ACCOUNT || "tajstake";
const STAKE_MIN_CONFIRMATIONS = Number(process.env.STAKE_MIN_CONFIRMATIONS || 1);
const STAKE_PAYMENT_TIMEOUT_MS = Number(process.env.STAKE_PAYMENT_TIMEOUT_MS || 30 * 60 * 1000);
const STAKE_POLL_MS = Number(process.env.STAKE_POLL_MS || 12_000);
const STAKE_SERVICE_ENABLED = process.env.STAKE_SERVICE_ENABLED !== "false";

class StakeService {
  constructor({ contentPool = null, stakingLedger = null, metricsStore = null } = {}) {
    this.contentPool = contentPool;
    this.stakingLedger = stakingLedger;
    this.metricsStore = metricsStore;
    this.sessions = new Map();
    this.pollTimer = null;
    this.lastScanAt = null;
    this.lastScanError = null;
  }

  isEnabled() {
    return STAKE_SERVICE_ENABLED;
  }

  setDeps({ contentPool, stakingLedger, metricsStore } = {}) {
    if (contentPool) this.contentPool = contentPool;
    if (stakingLedger) this.stakingLedger = stakingLedger;
    if (metricsStore) this.metricsStore = metricsStore;
  }

  publicSession(session) {
    if (!session) return null;
    return {
      sessionId: session.sessionId,
      status: session.status,
      contentCid: session.contentCid,
      stakerAddress: session.stakerAddress,
      amount: session.amount,
      periodId: session.periodId,
      periodDays: session.periodDays,
      periodLabel: session.periodLabel,
      paymentAddress: session.paymentAddress,
      minConfirmations: session.minConfirmations,
      pendingAmount: session.pendingAmount || 0,
      confirmations: session.confirmations || 0,
      txid: session.txid || null,
      stakeId: session.stakeId || null,
      preview: session.preview || null,
      createdAt: session.createdAt,
      paymentDeadline: session.paymentDeadline,
      completedAt: session.completedAt || null,
      error: session.error || null,
    };
  }

  status() {
    const sessions = [...this.sessions.values()];
    return {
      enabled: this.isEnabled(),
      account: STAKE_ACCOUNT,
      minStakeTaj: STAKE_MIN_TAJ,
      activeSessions: sessions.filter((s) => s.status === "pending").length,
      completedSessions: sessions.filter((s) => s.status === "completed").length,
      lastScanAt: this.lastScanAt,
      lastScanError: this.lastScanError,
    };
  }

  async init() {
    if (!this.isEnabled()) {
      console.log("📈 Stake service — désactivé (STAKE_SERVICE_ENABLED=false)");
      return;
    }
    try {
      const addresses = await tajcoinRpc("getaddressesbyaccount", [STAKE_ACCOUNT], LOCAL_PROFILE);
      if (!addresses?.length) {
        await tajcoinRpc("getnewaddress", [STAKE_ACCOUNT], LOCAL_PROFILE);
        console.log(`📈 Stake service — compte « ${STAKE_ACCOUNT} » initialisé`);
      } else {
        console.log(`📈 Stake service — compte « ${STAKE_ACCOUNT} » (${addresses.length} adresse(s))`);
      }
      this.startPolling();
    } catch (err) {
      console.warn(`⚠️  Stake service — init partielle : ${err.message}`);
    }
  }

  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.scanAllSessions().catch((err) => {
        this.lastScanError = err.message;
      });
      this.stakingLedger?.settleMatured({
        contentPool: this.contentPool,
        metricsStore: this.metricsStore,
      }).catch((err) => {
        this.lastScanError = err.message;
      });
    }, STAKE_POLL_MS);
    if (typeof this.pollTimer.unref === "function") {
      this.pollTimer.unref();
    }
  }

  pruneSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (session.status === "pending" && now > session.paymentDeadline) {
        session.status = "expired";
      }
      if (session.status === "expired" && now - session.paymentDeadline > STAKE_PAYMENT_TIMEOUT_MS) {
        this.sessions.delete(id);
      }
    }
  }

  async createRequest({ contentCid, stakerAddress, amount, periodId = "1m" }) {
    if (!this.isEnabled()) {
      throw new Error("Service de staking désactivé");
    }
    if (!contentCid || !stakerAddress) {
      throw new Error("contentCid et stakerAddress requis");
    }

    const value = Math.max(STAKE_MIN_TAJ, Number(amount) || 0);
    if (value + 1e-8 < STAKE_MIN_TAJ) {
      throw new Error(`Montant minimum : ${STAKE_MIN_TAJ} TAJ`);
    }

    const period = getPeriod(periodId);
    const metrics = buildContentMetrics(contentCid, {
      contentPool: this.contentPool,
      metricsStore: this.metricsStore,
    });
    const preview = previewStakeYield(
      { amount: value, periodId: period.id, periodDays: period.days },
      metrics,
      metrics.score
    );

    const sessionId = crypto.randomBytes(16).toString("hex");
    const paymentAddress = await tajcoinRpc("getnewaddress", [STAKE_ACCOUNT], LOCAL_PROFILE);
    const now = Date.now();
    const session = {
      sessionId,
      contentCid,
      stakerAddress,
      amount: value,
      periodId: period.id,
      periodDays: period.days,
      periodLabel: period.label,
      paymentAddress,
      minConfirmations: STAKE_MIN_CONFIRMATIONS,
      status: "pending",
      pendingAmount: 0,
      confirmations: 0,
      txid: null,
      stakeId: null,
      preview,
      createdAt: now,
      paymentDeadline: now + STAKE_PAYMENT_TIMEOUT_MS,
      completedAt: null,
      error: null,
    };
    this.sessions.set(sessionId, session);
    return this.publicSession(session);
  }

  async executeStake(session) {
    const metrics = buildContentMetrics(session.contentCid, {
      contentPool: this.contentPool,
      metricsStore: this.metricsStore,
    });
    const scoreAtStart = metrics.score;

    if (this.contentPool) {
      this.contentPool.addContribution(session.contentCid, {
        amount: session.amount,
        source: "investor-stake",
        txid: session.txid,
        payerAddress: session.stakerAddress,
      });
    }

    const stake = this.stakingLedger?.activateStake({
      stakeId: session.sessionId,
      contentCid: session.contentCid,
      stakerAddress: session.stakerAddress,
      amount: session.amount,
      periodId: session.periodId,
      paymentTxid: session.txid,
      scoreAtStart,
      projectedYield: session.preview,
    });

    session.stakeId = stake?.stakeId || session.sessionId;
    session.status = "completed";
    session.completedAt = Date.now();
    return session;
  }

  async scanSession(session) {
    if (!session || session.status !== "pending") {
      return session;
    }

    if (Date.now() > session.paymentDeadline) {
      session.status = "expired";
      return session;
    }

    const pendingAmount =
      Number(await tajcoinRpc("getreceivedbyaddress", [session.paymentAddress, 0], LOCAL_PROFILE)) || 0;
    session.pendingAmount = pendingAmount;

    const confirmedAmount =
      Number(
        await tajcoinRpc(
          "getreceivedbyaddress",
          [session.paymentAddress, session.minConfirmations],
          LOCAL_PROFILE
        )
      ) || 0;

    if (confirmedAmount + 1e-8 < session.amount) {
      return session;
    }

    const txs = await tajcoinRpc("listtransactions", ["*", 200], LOCAL_PROFILE);
    const incoming = txs
      .filter((tx) => tx.category === "receive" && tx.address === session.paymentAddress)
      .sort((a, b) => (b.time || 0) - (a.time || 0));

    if (incoming.length) {
      const tx = incoming[0];
      session.txid = tx.txid;
      session.confirmations = tx.confirmations || 0;
    }

    if ((session.confirmations || 0) < session.minConfirmations) {
      return session;
    }

    try {
      await this.executeStake(session);
    } catch (err) {
      session.status = "failed";
      session.error = err.message;
    }

    return session;
  }

  async scanAllSessions() {
    this.lastScanAt = Date.now();
    this.lastScanError = null;
    this.pruneSessions();
    for (const session of this.sessions.values()) {
      if (session.status === "pending") {
        await this.scanSession(session);
      }
    }
  }

  getSession(sessionId) {
    this.pruneSessions();
    return this.sessions.get(sessionId) || null;
  }

  async refreshSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    if (session.status === "pending") {
      await this.scanSession(session);
    }
    return this.publicSession(this.getSession(sessionId));
  }
}

module.exports = { StakeService, STAKE_SERVICE_ENABLED };
