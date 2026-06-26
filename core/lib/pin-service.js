"use strict";

const crypto = require("crypto");
const { tajcoinRpc, LOCAL_PROFILE } = require("./tajcoin");
const { pinCid } = require("./ipfs");

const PIN_ACCOUNT = process.env.PIN_ACCOUNT || "tajpin";
const PIN_MIN_CONFIRMATIONS = Number(process.env.PIN_MIN_CONFIRMATIONS || 1);
const PIN_PAYMENT_TIMEOUT_MS = Number(process.env.PIN_PAYMENT_TIMEOUT_MS || 30 * 60 * 1000);
const PIN_POLL_MS = Number(process.env.PIN_POLL_MS || 12_000);
const PIN_SERVICE_ENABLED = process.env.PIN_SERVICE_ENABLED !== "false";

class PinService {
  constructor({ discover = null, contentPool = null } = {}) {
    this.discover = discover;
    this.contentPool = contentPool;
    this.sessions = new Map();
    this.pollTimer = null;
    this.lastScanAt = null;
    this.lastScanError = null;
  }

  setDiscover(discover) {
    this.discover = discover;
  }

  setContentPool(contentPool) {
    this.contentPool = contentPool;
  }

  isEnabled() {
    return PIN_SERVICE_ENABLED;
  }

  getPrice() {
    return Number(this.discover?.profile?.pinPriceTaj || process.env.DISCOVER_PIN_PRICE_TAJ || 0.5);
  }

  publicSession(session) {
    if (!session) return null;
    return {
      sessionId: session.sessionId,
      status: session.status,
      contentCid: session.contentCid,
      title: session.title || null,
      paymentAddress: session.paymentAddress,
      amount: session.amount,
      minConfirmations: session.minConfirmations,
      pendingAmount: session.pendingAmount || 0,
      confirmations: session.confirmations || 0,
      txid: session.txid || null,
      pinTxid: session.pinTxid || null,
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
      account: PIN_ACCOUNT,
      price: this.getPrice(),
      minConfirmations: PIN_MIN_CONFIRMATIONS,
      activeSessions: sessions.filter((s) => s.status === "pending").length,
      completedSessions: sessions.filter((s) => s.status === "completed").length,
      lastScanAt: this.lastScanAt,
      lastScanError: this.lastScanError,
    };
  }

  async init() {
    if (!this.isEnabled()) {
      console.log("📌 Pin service — désactivé (PIN_SERVICE_ENABLED=false)");
      return;
    }
    try {
      const addresses = await tajcoinRpc("getaddressesbyaccount", [PIN_ACCOUNT], LOCAL_PROFILE);
      if (!addresses?.length) {
        await tajcoinRpc("getnewaddress", [PIN_ACCOUNT], LOCAL_PROFILE);
        console.log(`📌 Pin service — compte « ${PIN_ACCOUNT} » initialisé`);
      } else {
        console.log(`📌 Pin service — compte « ${PIN_ACCOUNT} » (${addresses.length} adresse(s)) — ${this.getPrice()} TAJ/pin`);
      }
      this.startPolling();
    } catch (err) {
      console.warn(`⚠️  Pin service — init partielle : ${err.message}`);
    }
  }

  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.scanAllSessions().catch((err) => {
        this.lastScanError = err.message;
      });
    }, PIN_POLL_MS);
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
      if (session.status === "expired" && now - session.paymentDeadline > PIN_PAYMENT_TIMEOUT_MS) {
        this.sessions.delete(id);
      }
    }
  }

  async createRequest({ contentCid, title = null, sourceTxid = null }) {
    if (!this.isEnabled()) {
      throw new Error("Service de pinning désactivé");
    }
    if (!contentCid) {
      throw new Error("contentCid requis");
    }

    const sessionId = crypto.randomBytes(16).toString("hex");
    const paymentAddress = await tajcoinRpc("getnewaddress", [PIN_ACCOUNT], LOCAL_PROFILE);
    const now = Date.now();
    const session = {
      sessionId,
      contentCid,
      title,
      sourceTxid,
      paymentAddress,
      amount: this.getPrice(),
      minConfirmations: PIN_MIN_CONFIRMATIONS,
      status: "pending",
      pendingAmount: 0,
      confirmations: 0,
      txid: null,
      pinTxid: null,
      createdAt: now,
      paymentDeadline: now + PIN_PAYMENT_TIMEOUT_MS,
      completedAt: null,
      error: null,
    };
    this.sessions.set(sessionId, session);
    return this.publicSession(session);
  }

  async executePin(session) {
    await pinCid(session.contentCid);
    if (this.contentPool && session.amount > 0 && session.txid) {
      this.contentPool.addContribution(session.contentCid, {
        amount: session.amount,
        source: "pin-service",
        txid: session.txid,
        payerAddress: session.paymentAddress,
        sourceTxid: session.sourceTxid,
      });
    }
    if (this.discover?.recordPin) {
      await this.discover.recordPin({
        contentCid: session.contentCid,
        title: session.title,
        sourceTxid: session.sourceTxid,
        paid: true,
        amount: session.amount,
        paymentTxid: session.txid,
        paymentAddress: session.paymentAddress,
      });
    }
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
      await this.executePin(session);
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

module.exports = { PinService, PIN_SERVICE_ENABLED };
