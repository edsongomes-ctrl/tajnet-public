"use strict";

const crypto = require("crypto");
const { tajcoinRpc, LOCAL_PROFILE } = require("./tajcoin");

const GUARD_ACCOUNT = process.env.GUARD_ACCOUNT || "tajguard";
const GUARD_PRICE_TAJ = Number(process.env.GUARD_PRICE_TAJ || 1);
const GUARD_MIN_CONFIRMATIONS = Number(process.env.GUARD_MIN_CONFIRMATIONS || 1);
const GUARD_SESSION_TTL_MS = Number(process.env.GUARD_SESSION_TTL_MS || 60 * 60 * 1000);
const GUARD_PAYMENT_TIMEOUT_MS = Number(process.env.GUARD_PAYMENT_TIMEOUT_MS || 15 * 60 * 1000);
const GUARD_POLL_MS = Number(process.env.GUARD_POLL_MS || 12_000);
const GUARD_PAYMENT_ADDRESS = process.env.GUARD_PAYMENT_ADDRESS || "";
const GUARD_BYPASS = process.env.GUARD_BYPASS === "true";

class GuardDaemon {
  constructor({ walletDir } = {}) {
    this.walletDir = walletDir;
    this.sessions = new Map();
    this.pollTimer = null;
    this.lastScanAt = null;
    this.lastScanError = null;
    this.paymentAddressReady = Boolean(GUARD_PAYMENT_ADDRESS);
  }

  isBypassed() {
    return GUARD_BYPASS;
  }

  hasActiveUnlock() {
    if (GUARD_BYPASS) {
      return true;
    }
    this.pruneSessions();
    return [...this.sessions.values()].some((s) => s.status === "unlocked");
  }

  isSessionValid(sessionId) {
    if (GUARD_BYPASS) {
      return true;
    }
    if (!sessionId) {
      return false;
    }
    this.pruneSessions();
    const session = this.sessions.get(sessionId);
    return Boolean(session && session.status === "unlocked" && Date.now() < session.unlockedUntil);
  }

  getSession(sessionId) {
    this.pruneSessions();
    return this.sessions.get(sessionId) || null;
  }

  getActiveUnlockedSession() {
    this.pruneSessions();
    const now = Date.now();
    const unlocked = [...this.sessions.values()]
      .filter((s) => s.status === "unlocked" && (!s.unlockedUntil || now < s.unlockedUntil))
      .sort((a, b) => (b.unlockedAt || 0) - (a.unlockedAt || 0));
    return unlocked[0] || null;
  }

  publicSession(session) {
    if (!session) {
      return null;
    }
    return {
      sessionId: session.sessionId,
      status: session.status,
      paymentAddress: session.paymentAddress,
      amount: session.amount,
      minConfirmations: session.minConfirmations,
      pendingAmount: session.pendingAmount || 0,
      confirmations: session.confirmations || 0,
      txid: session.txid || null,
      createdAt: session.createdAt,
      paymentDeadline: session.paymentDeadline,
      unlockedUntil: session.unlockedUntil || null,
      unlockedAt: session.unlockedAt || null,
    };
  }

  status() {
    this.pruneSessions();
    const sessions = [...this.sessions.values()];
    const unlocked = sessions.filter((s) => s.status === "unlocked");
    const pending = sessions.filter((s) => s.status === "pending");

    const locked = !GUARD_BYPASS && unlocked.length === 0;

    return {
      locked,
      bypass: GUARD_BYPASS,
      walletDir: this.walletDir,
      price: GUARD_PRICE_TAJ,
      minConfirmations: GUARD_MIN_CONFIRMATIONS,
      account: GUARD_ACCOUNT,
      paymentAddress: GUARD_PAYMENT_ADDRESS || null,
      activeUnlocks: unlocked.length,
      pendingPayments: pending.length,
      lastScanAt: this.lastScanAt,
      lastScanError: this.lastScanError,
      message: GUARD_BYPASS
        ? "Guard désactivé (GUARD_BYPASS) — accès libre"
        : locked
          ? "Porte d'entrée verrouillée — paiement Tajcoin requis"
          : "Porte d'entrée ouverte — session active",
    };
  }

  async init() {
    if (GUARD_BYPASS) {
      console.log("🔓 Guard Daemon — bypass actif (GUARD_BYPASS=true)");
      return;
    }

    try {
      if (!GUARD_PAYMENT_ADDRESS) {
        const addresses = await tajcoinRpc("getaddressesbyaccount", [GUARD_ACCOUNT], LOCAL_PROFILE);
        if (!addresses?.length) {
          await tajcoinRpc("getnewaddress", [GUARD_ACCOUNT], LOCAL_PROFILE);
          console.log(`🛡️  Guard — compte « ${GUARD_ACCOUNT} » initialisé`);
        } else {
          console.log(`🛡️  Guard — compte « ${GUARD_ACCOUNT} » (${addresses.length} adresse(s))`);
        }
      } else {
        console.log(`🛡️  Guard — adresse fixe ${GUARD_PAYMENT_ADDRESS}`);
      }
      this.startPolling();
    } catch (err) {
      console.warn(`⚠️  Guard Daemon — init partielle : ${err.message}`);
    }
  }

  startPolling() {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(() => {
      this.scanAllSessions().catch((err) => {
        this.lastScanError = err.message;
      });
    }, GUARD_POLL_MS);
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  pruneSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (session.status === "pending" && now > session.paymentDeadline) {
        session.status = "expired";
      }
      if (session.status === "unlocked" && session.unlockedUntil && now > session.unlockedUntil) {
        session.status = "expired";
      }
      if (session.status === "expired" && now - session.paymentDeadline > GUARD_SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }

  async createPaymentSession() {
    if (GUARD_BYPASS) {
      const sessionId = crypto.randomBytes(16).toString("hex");
      const now = Date.now();
      const session = {
        sessionId,
        paymentAddress: "bypass",
        amount: 0,
        minConfirmations: 0,
        status: "unlocked",
        createdAt: now,
        paymentDeadline: now + GUARD_PAYMENT_TIMEOUT_MS,
        unlockedAt: now,
        unlockedUntil: now + GUARD_SESSION_TTL_MS,
      };
      this.sessions.set(sessionId, session);
      return this.publicSession(session);
    }

    const sessionId = crypto.randomBytes(16).toString("hex");
    let paymentAddress = GUARD_PAYMENT_ADDRESS;

    if (!paymentAddress) {
      paymentAddress = await tajcoinRpc("getnewaddress", [GUARD_ACCOUNT], LOCAL_PROFILE);
    }

    const now = Date.now();
    const session = {
      sessionId,
      paymentAddress,
      amount: GUARD_PRICE_TAJ,
      minConfirmations: GUARD_MIN_CONFIRMATIONS,
      status: "pending",
      pendingAmount: 0,
      confirmations: 0,
      txid: null,
      createdAt: now,
      paymentDeadline: now + GUARD_PAYMENT_TIMEOUT_MS,
      unlockedUntil: null,
      unlockedAt: null,
    };

    this.sessions.set(sessionId, session);
    return this.publicSession(session);
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

    const now = Date.now();
    session.status = "unlocked";
    session.unlockedAt = now;
    session.unlockedUntil = now + GUARD_SESSION_TTL_MS;
    return session;
  }

  async scanAllSessions() {
    this.lastScanAt = Date.now();
    this.lastScanError = null;

    for (const session of this.sessions.values()) {
      if (session.status === "pending") {
        await this.scanSession(session);
      }
    }
  }

  async refreshSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }
    if (session.status === "pending") {
      await this.scanSession(session);
    }
    return this.publicSession(this.getSession(sessionId));
  }

  lockSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = "expired";
      session.unlockedUntil = Date.now();
    }
  }

  lockAll() {
    for (const session of this.sessions.values()) {
      session.status = "expired";
      session.unlockedUntil = Date.now();
    }
  }
}

module.exports = { GuardDaemon, GUARD_PRICE_TAJ, GUARD_BYPASS };
