"use strict";

const crypto = require("crypto");
const { tajcoinRpc, LOCAL_PROFILE } = require("./tajcoin");

const BRAN_PUBLISH_ACCOUNT = process.env.BRAN_PUBLISH_ACCOUNT || "tajbran";
const BRAN_PUBLISH_PRICE_TAJ = Number(process.env.BRAN_PUBLISH_PRICE_TAJ || 2);
const BRAN_PUBLISH_MIN_CONFIRMATIONS = Number(process.env.BRAN_PUBLISH_MIN_CONFIRMATIONS || 1);
const BRAN_PUBLISH_PAYMENT_TIMEOUT_MS = Number(process.env.BRAN_PUBLISH_PAYMENT_TIMEOUT_MS || 30 * 60 * 1000);
const BRAN_PUBLISH_POLL_MS = Number(process.env.BRAN_PUBLISH_POLL_MS || 12_000);
const BRAN_PUBLISH_ENABLED = process.env.BRAN_PUBLISH_ENABLED !== "false";
const BRAN_HTML_MAX_BYTES = Number(process.env.BRAN_HTML_MAX_BYTES || 2 * 1024 * 1024);

class BranPublishService {
  constructor() {
    this.sessions = new Map();
    this.pollTimer = null;
    this.lastScanAt = null;
    this.lastScanError = null;
    this.deps = {};
  }

  setDeps(deps = {}) {
    this.deps = { ...this.deps, ...deps };
  }

  isEnabled() {
    return BRAN_PUBLISH_ENABLED;
  }

  getPrice() {
    return BRAN_PUBLISH_PRICE_TAJ;
  }

  publicSession(session) {
    if (!session) return null;
    return {
      sessionId: session.sessionId,
      status: session.status,
      title: session.title,
      publisherAddress: session.publisherAddress,
      paymentAddress: session.paymentAddress,
      amount: session.amount,
      minConfirmations: session.minConfirmations,
      pendingAmount: session.pendingAmount || 0,
      confirmations: session.confirmations || 0,
      txid: session.txid || null,
      contentCid: session.contentCid || null,
      announceTxid: session.announceTxid || null,
      metadataCid: session.metadataCid || null,
      gatewayUrl: session.gatewayUrl || null,
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
      account: BRAN_PUBLISH_ACCOUNT,
      price: this.getPrice(),
      minConfirmations: BRAN_PUBLISH_MIN_CONFIRMATIONS,
      activeSessions: sessions.filter((s) => s.status === "pending").length,
      completedSessions: sessions.filter((s) => s.status === "completed").length,
      lastScanAt: this.lastScanAt,
      lastScanError: this.lastScanError,
    };
  }

  async init() {
    if (!this.isEnabled()) {
      console.log("🌿 Bran publish — désactivé (BRAN_PUBLISH_ENABLED=false)");
      return;
    }
    try {
      const addresses = await tajcoinRpc("getaddressesbyaccount", [BRAN_PUBLISH_ACCOUNT], LOCAL_PROFILE);
      if (!addresses?.length) {
        await tajcoinRpc("getnewaddress", [BRAN_PUBLISH_ACCOUNT], LOCAL_PROFILE);
        console.log(`🌿 Bran publish — compte « ${BRAN_PUBLISH_ACCOUNT} » initialisé`);
      } else {
        console.log(
          `🌿 Bran publish — compte « ${BRAN_PUBLISH_ACCOUNT} » — ${this.getPrice()} TAJ/publication HTML`
        );
      }
      this.startPolling();
    } catch (err) {
      console.warn(`⚠️  Bran publish — init partielle : ${err.message}`);
    }
  }

  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.scanAllSessions().catch((err) => {
        this.lastScanError = err.message;
      });
    }, BRAN_PUBLISH_POLL_MS);
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
      if (session.status === "expired" && now - session.paymentDeadline > BRAN_PUBLISH_PAYMENT_TIMEOUT_MS) {
        this.sessions.delete(id);
      }
    }
  }

  async createRequest({ html, title = "Archive Bran Web", publisherAddress }) {
    if (!this.isEnabled()) {
      throw new Error("Publication Bran Web désactivée");
    }
    if (!html || typeof html !== "string") {
      throw new Error("html requis");
    }
    if (Buffer.byteLength(html, "utf8") > BRAN_HTML_MAX_BYTES) {
      throw new Error(`HTML trop volumineux (max ${BRAN_HTML_MAX_BYTES} octets)`);
    }
    if (!publisherAddress) {
      throw new Error("Connectez MetaMask pour publier sur IPFS");
    }

    const sessionId = crypto.randomBytes(16).toString("hex");
    const paymentAddress = await tajcoinRpc("getnewaddress", [BRAN_PUBLISH_ACCOUNT], LOCAL_PROFILE);
    const now = Date.now();
    const session = {
      sessionId,
      html,
      title: String(title || "Archive Bran Web").slice(0, 120),
      publisherAddress: String(publisherAddress).toLowerCase(),
      paymentAddress,
      amount: this.getPrice(),
      minConfirmations: BRAN_PUBLISH_MIN_CONFIRMATIONS,
      status: "pending",
      pendingAmount: 0,
      confirmations: 0,
      txid: null,
      contentCid: null,
      announceTxid: null,
      metadataCid: null,
      gatewayUrl: null,
      createdAt: now,
      paymentDeadline: now + BRAN_PUBLISH_PAYMENT_TIMEOUT_MS,
      completedAt: null,
      error: null,
    };
    this.sessions.set(sessionId, session);
    return this.publicSession(session);
  }

  async executePublish(session, req = null) {
    const { addHtmlToIpfs, publishAnnouncement, trackAnnouncement, discover, buildClientIpfsUrls } =
      this.deps;
    if (!addHtmlToIpfs || !publishAnnouncement) {
      throw new Error("Service publication incomplet");
    }

    const { cid, fileCid } = await addHtmlToIpfs(session.html);
    const urls = buildClientIpfsUrls && req ? buildClientIpfsUrls(cid, req) : {};

    const announce = trackAnnouncement
      ? await trackAnnouncement(
          await publishAnnouncement({
            type: "page",
            contentCid: cid,
            title: session.title,
            extra: {
              format: "bran-web",
              fileCid,
              publisherAddress: session.publisherAddress,
            },
          }),
          { title: session.title }
        )
      : await publishAnnouncement({
          type: "page",
          contentCid: cid,
          title: session.title,
          extra: {
            format: "bran-web",
            fileCid,
            publisherAddress: session.publisherAddress,
          },
        });

    if (discover?.recordPin) {
      await discover.recordPin({
        contentCid: cid,
        title: session.title,
        sourceTxid: announce?.txid || null,
        paid: true,
        amount: session.amount,
        paymentTxid: session.txid,
        paymentAddress: session.paymentAddress,
      });
    }

    session.contentCid = cid;
    session.announceTxid = announce?.txid || null;
    session.metadataCid = announce?.metadataCid || null;
    session.gatewayUrl = urls.contentUrl || urls.gatewayUrl || null;
    session.status = "completed";
    session.completedAt = Date.now();
    return session;
  }

  async scanSession(session, req = null) {
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
      await this.executePublish(session, req);
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

  async refreshSession(sessionId, req = null) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    if (session.status === "pending") {
      await this.scanSession(session, req);
    }
    return this.publicSession(this.getSession(sessionId));
  }
}

module.exports = { BranPublishService, BRAN_PUBLISH_ENABLED };
