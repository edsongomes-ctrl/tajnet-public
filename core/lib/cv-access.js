"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { tajcoinRpc, LOCAL_PROFILE } = require("./tajcoin");

const CV_ACCESS_ACCOUNT = process.env.CV_ACCESS_ACCOUNT || "tajcv";
const CV_ACCESS_PRICE_TAJ = Number(process.env.CV_ACCESS_PRICE_TAJ || 1);
const CV_ACCESS_MIN_CONFIRMATIONS = Number(process.env.CV_ACCESS_MIN_CONFIRMATIONS || 1);
const CV_ACCESS_PAYMENT_TIMEOUT_MS = Number(process.env.CV_ACCESS_PAYMENT_TIMEOUT_MS || 30 * 60 * 1000);
const CV_ACCESS_POLL_MS = Number(process.env.CV_ACCESS_POLL_MS || 12_000);
const CV_ACCESS_ENABLED = process.env.CV_ACCESS_ENABLED !== "false";

function grantKey(profileId, address) {
  return `${profileId}:${String(address || "").toLowerCase()}`;
}

class CvAccessService {
  constructor({ dataDir } = {}) {
    this.dataDir = dataDir;
    this.grantsPath = dataDir ? path.join(dataDir, "access-grants.json") : null;
    this.grants = {};
    this.sessions = new Map();
    this.pollTimer = null;
    this.lastScanAt = null;
    this.lastScanError = null;
  }

  loadGrants() {
    if (!this.grantsPath) return;
    fs.mkdirSync(this.dataDir, { recursive: true });
    try {
      if (fs.existsSync(this.grantsPath)) {
        this.grants = JSON.parse(fs.readFileSync(this.grantsPath, "utf8")) || {};
      }
    } catch {
      this.grants = {};
    }
  }

  persistGrants() {
    if (!this.grantsPath) return;
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.grantsPath, `${JSON.stringify(this.grants, null, 2)}\n`, "utf8");
  }

  isEnabled() {
    return CV_ACCESS_ENABLED;
  }

  getPrice() {
    return CV_ACCESS_PRICE_TAJ;
  }

  hasAccess(profileId, recruiterAddress) {
    if (!profileId || !recruiterAddress) return false;
    return Boolean(this.grants[grantKey(profileId, recruiterAddress)]);
  }

  grantAccess(profileId, recruiterAddress, { txid = null, sessionId = null } = {}) {
    if (!profileId || !recruiterAddress) return null;
    const key = grantKey(profileId, recruiterAddress);
    const grant = {
      profileId,
      recruiterAddress: String(recruiterAddress).toLowerCase(),
      txid,
      sessionId,
      unlockedAt: new Date().toISOString(),
    };
    this.grants[key] = grant;
    this.persistGrants();
    return grant;
  }

  publicSession(session) {
    if (!session) return null;
    return {
      sessionId: session.sessionId,
      status: session.status,
      profileId: session.profileId,
      contentCid: session.contentCid,
      title: session.title || null,
      recruiterAddress: session.recruiterAddress,
      paymentAddress: session.paymentAddress,
      amount: session.amount,
      minConfirmations: session.minConfirmations,
      pendingAmount: session.pendingAmount || 0,
      confirmations: session.confirmations || 0,
      txid: session.txid || null,
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
      account: CV_ACCESS_ACCOUNT,
      price: this.getPrice(),
      minConfirmations: CV_ACCESS_MIN_CONFIRMATIONS,
      grantCount: Object.keys(this.grants).length,
      activeSessions: sessions.filter((s) => s.status === "pending").length,
      completedSessions: sessions.filter((s) => s.status === "completed").length,
      lastScanAt: this.lastScanAt,
      lastScanError: this.lastScanError,
    };
  }

  async init() {
    this.loadGrants();
    if (!this.isEnabled()) {
      console.log("📋 CV access — désactivé (CV_ACCESS_ENABLED=false)");
      return;
    }
    try {
      const addresses = await tajcoinRpc("getaddressesbyaccount", [CV_ACCESS_ACCOUNT], LOCAL_PROFILE);
      if (!addresses?.length) {
        await tajcoinRpc("getnewaddress", [CV_ACCESS_ACCOUNT], LOCAL_PROFILE);
        console.log(`📋 CV access — compte « ${CV_ACCESS_ACCOUNT} » initialisé`);
      } else {
        console.log(
          `📋 CV access — compte « ${CV_ACCESS_ACCOUNT} » (${addresses.length} adresse(s)) — ${this.getPrice()} TAJ/consultation`
        );
      }
      this.startPolling();
    } catch (err) {
      console.warn(`⚠️  CV access — init partielle : ${err.message}`);
    }
  }

  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.scanAllSessions().catch((err) => {
        this.lastScanError = err.message;
      });
    }, CV_ACCESS_POLL_MS);
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
      if (session.status === "expired" && now - session.paymentDeadline > CV_ACCESS_PAYMENT_TIMEOUT_MS) {
        this.sessions.delete(id);
      }
    }
  }

  async createRequest({ profileId, contentCid, title = null, recruiterAddress }) {
    if (!this.isEnabled()) {
      throw new Error("Consultation CV payante désactivée");
    }
    if (!profileId || !contentCid) {
      throw new Error("profileId et contentCid requis");
    }
    if (!recruiterAddress) {
      throw new Error("Connectez MetaMask pour débloquer la consultation");
    }

    const sessionId = crypto.randomBytes(16).toString("hex");
    const paymentAddress = await tajcoinRpc("getnewaddress", [CV_ACCESS_ACCOUNT], LOCAL_PROFILE);
    const now = Date.now();
    const session = {
      sessionId,
      profileId,
      contentCid,
      title,
      recruiterAddress: String(recruiterAddress).toLowerCase(),
      paymentAddress,
      amount: this.getPrice(),
      minConfirmations: CV_ACCESS_MIN_CONFIRMATIONS,
      status: "pending",
      pendingAmount: 0,
      confirmations: 0,
      txid: null,
      createdAt: now,
      paymentDeadline: now + CV_ACCESS_PAYMENT_TIMEOUT_MS,
      completedAt: null,
      error: null,
    };
    this.sessions.set(sessionId, session);
    return this.publicSession(session);
  }

  executeAccess(session) {
    this.grantAccess(session.profileId, session.recruiterAddress, {
      txid: session.txid,
      sessionId: session.sessionId,
    });
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
      this.executeAccess(session);
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

module.exports = { CvAccessService, CV_ACCESS_ENABLED };
