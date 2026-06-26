"use strict";

const express = require("express");

const { protocolsConfig } = require("../lib/cid-protocols");
const { resolveClaimAddress } = require("./pin-rewards");
const { getRequestZone, requireNonWanOperator } = require("../lib/request-local");

function createDiscoverRouter(discover, pinService = null) {
  const router = express.Router();

  router.get("/status", (_req, res) => {
    res.json({ success: true, discover: discover.status() });
  });

  router.get("/config", requireNonWanOperator, (_req, res) => {
    res.json({
      success: true,
      discover: {
        enabled: discover.isEnabled(),
        fetchMetadata: process.env.DISCOVER_FETCH_METADATA !== "false",
        walletScan: process.env.DISCOVER_WALLET_SCAN !== "false",
        walletTxLimit: Number(process.env.DISCOVER_WALLET_TX_LIMIT || 5000),
        blocksPerScan: Number(process.env.DISCOVER_BLOCKS_PER_SCAN || 120),
        lookbackBlocks: Number(process.env.DISCOVER_LOOKBACK_BLOCKS || 5000),
        protocols: protocolsConfig(),
      },
    });
  });

  router.post("/enable", requireNonWanOperator, (_req, res) => {
    res.json({ success: true, discover: discover.setEnabled(true) });
  });

  router.post("/disable", requireNonWanOperator, (_req, res) => {
    res.json({ success: true, discover: discover.setEnabled(false) });
  });

  router.post("/scan", requireNonWanOperator, async (_req, res) => {
    try {
      const result = await discover.scan({ force: true });
      res.json({ success: true, scan: result, discover: discover.status() });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message, discover: discover.status() });
    }
  });

  router.post("/scan-wallet", requireNonWanOperator, async (_req, res) => {
    try {
      const walletScan = await discover.scanWalletTransactions();
      res.json({ success: true, walletScan, discover: discover.status() });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message, discover: discover.status() });
    }
  });

  router.post("/import-registry", requireNonWanOperator, (req, res) => {
    try {
      const items = Array.isArray(req.body?.entries)
        ? req.body.entries
        : Array.isArray(req.body)
          ? req.body
          : [];
      const imported = discover.importRegistryEntries(items, req.body?.source || "registry-import");
      res.json({ success: true, imported, discover: discover.status() });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get("/entries", async (req, res) => {
    const q = req.query.q || "";
    const type = req.query.type || "";
    const protocol = req.query.protocol || "";
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const claimAddress = resolveClaimAddress(req) || String(req.query.claimAddress || "").trim() || null;
    const { getRequestOrigin } = require("../lib/ipfs-gateway");
    try {
      res.json({
        success: true,
        ...(await discover.listEntries({
          q,
          type,
          protocol,
          limit,
          offset,
          clientOrigin: getRequestOrigin(req),
          claimAddress,
        })),
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get("/entries/:txid", async (req, res) => {
    const entry = discover.getEntry(req.params.txid);
    if (!entry) {
      return res.status(404).json({ success: false, error: "Entrée introuvable" });
    }
    try {
      if (entry.metadataCid && entry.metadataStatus !== "resolved") {
        await discover.reenrichIfNeeded(entry);
        discover.persistIndex();
      }
      const claimAddress = resolveClaimAddress(req) || String(req.query.claimAddress || "").trim() || null;
      const { getRequestOrigin } = require("../lib/ipfs-gateway");
      const enriched = discover.enrichEntryForClient(entry, {
        clientOrigin: getRequestOrigin(req),
        claimAddress,
      });
      if (claimAddress && enriched.contentCid) {
        enriched.poolClaimedByMe =
          discover.contentPool?.hasClaimed(enriched.contentCid, claimAddress) || false;
      }
      res.json({ success: true, entry: enriched });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post("/entries/:txid/pin", async (req, res) => {
    try {
      if (getRequestZone(req) !== "localhost") {
        return res.status(403).json({
          success: false,
          error:
            "Épinglage gratuit réservé à l'opérateur sur localhost — à distance, utilisez « Soutenir (don pinning) » (MetaMask).",
        });
      }
      const result = await discover.pinDiscoverEntry(req.params.txid);
      res.json({ success: true, ...result, discover: discover.status() });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post("/entries/:txid/view", async (req, res) => {
    try {
      const viewerAddress = resolveClaimAddress(req);
      if (!viewerAddress) {
        return res.status(400).json({
          success: false,
          error: "Connectez MetaMask pour attester la consultation du contenu",
        });
      }
      const result = discover.attestContentView(req.params.txid, viewerAddress);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get("/entries/:txid/claim-eligibility", (req, res) => {
    const entry = discover.getEntry(req.params.txid);
    if (!entry?.contentCid) {
      return res.status(404).json({ success: false, error: "Entrée introuvable" });
    }
    const claimAddress = resolveClaimAddress(req) || String(req.query.claimAddress || "").trim();
    if (!claimAddress) {
      return res.status(400).json({ success: false, error: "claimAddress ou session MetaMask requis" });
    }
    res.json({
      success: true,
      eligibility: discover.getClaimEligibility(entry.contentCid, claimAddress),
    });
  });

  router.post("/entries/:txid/claim", async (req, res) => {
    try {
      const claimAddress = resolveClaimAddress(req);
      if (!claimAddress) {
        return res.status(400).json({
          success: false,
          error: "Connectez MetaMask ou indiquez claimAddress",
        });
      }
      const result = await discover.claimDiscoverReward(req.params.txid, claimAddress);
      res.json({
        success: result.status === "paid",
        ...result,
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post("/entries/:txid/pin-request", async (req, res) => {
    try {
      if (!pinService?.isEnabled()) {
        return res.status(503).json({ success: false, error: "Service de pinning payant indisponible" });
      }
      const entry = discover.getEntry(req.params.txid);
      if (!entry?.contentCid) {
        return res.status(404).json({ success: false, error: "Entrée ou CID introuvable" });
      }
      const session = await pinService.createRequest({
        contentCid: entry.contentCid,
        title: entry.title,
        sourceTxid: req.params.txid,
      });
      res.json({ success: true, session, pinService: pinService.status() });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get("/pins", requireNonWanOperator, (req, res) => {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    res.json({ success: true, ...discover.listPins({ limit, offset }) });
  });

  router.get("/nodes", (_req, res) => {
    res.json({ success: true, nodes: discover.listNodes() });
  });

  router.post("/profile", requireNonWanOperator, (req, res) => {
    try {
      const profile = discover.updateProfile(req.body || {});
      res.json({ success: true, profile, discover: discover.status() });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post("/nodes", requireNonWanOperator, (req, res) => {
    try {
      const partner = discover.addPartner(req.body || {});
      res.json({ success: true, partner, nodes: discover.listNodes() });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.delete("/nodes/:id", requireNonWanOperator, (req, res) => {
    discover.removePartner(req.params.id);
    res.json({ success: true, nodes: discover.listNodes() });
  });

  return router;
}

module.exports = { createDiscoverRouter };
