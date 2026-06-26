"use strict";

const express = require("express");
const multer = require("multer");
const { isLocalhostRequest } = require("../lib/request-local");
const {
  walletDatStatus,
  readWalletDatBuffer,
  writeWalletDatBuffer,
} = require("../lib/tajcoin-wallet-file");
const {
  listAddNodes,
  addAddNodes,
  removeAddNode,
  getLivePeerSummary,
  tajcoinNodesStatus,
} = require("../lib/tajcoin-conf-nodes");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 * 1024 },
});

function requireLocalhostOperator(req, res, next) {
  if (!isLocalhostRequest(req)) {
    return res.status(403).json({
      success: false,
      error: "Opération réservée à localhost — seul l'opérateur du nœud peut gérer wallet.dat",
    });
  }
  next();
}

function createLandingRouter({ dataDir, loadLandingProfile, saveLandingProfile }) {
  const router = express.Router();

  router.get("/profile", (_req, res) => {
    res.json({ success: true, profile: loadLandingProfile(dataDir) });
  });

  router.put("/profile", requireLocalhostOperator, (req, res) => {
    try {
      const profile = saveLandingProfile(dataDir, req.body?.profile || req.body || {});
      res.json({ success: true, profile });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

function createTajcoinWalletRouter() {
  const router = express.Router();

  router.get("/status", requireLocalhostOperator, (_req, res) => {
    res.json({ success: true, ...walletDatStatus() });
  });

  router.get("/export", requireLocalhostOperator, (_req, res) => {
    try {
      const { buffer, path: walletPath } = readWalletDatBuffer();
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", 'attachment; filename="wallet.dat"');
      res.setHeader("X-Tajnet-Wallet-Path", walletPath);
      res.send(buffer);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });

  router.post("/import", requireLocalhostOperator, upload.single("wallet"), (req, res) => {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ success: false, error: "Fichier wallet.dat requis (champ wallet)" });
    }
    if (req.file.size < 1000) {
      return res.status(400).json({ success: false, error: "Fichier trop petit pour être un wallet.dat valide" });
    }
    try {
      const result = writeWalletDatBuffer(req.file.buffer);
      res.json({
        success: true,
        message: "wallet.dat importé — redémarrez tajcoind pour appliquer",
        ...result,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message,
        hint: "Vérifiez les droits d'écriture sur TAJCOIN_DATA_DIR (montage Docker en lecture seule ?)",
      });
    }
  });

  return router;
}

function createTajcoinNodesRouter() {
  const router = express.Router();

  router.get("/", requireLocalhostOperator, async (_req, res) => {
    try {
      const conf = listAddNodes();
      const live = await getLivePeerSummary();
      res.json({ success: true, ...conf, live });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });

  router.post("/", requireLocalhostOperator, async (req, res) => {
    const nodes = req.body?.nodes ?? req.body?.node;
    if (!nodes) {
      return res.status(400).json({ success: false, error: "Champ node ou nodes requis" });
    }
    try {
      const result = await addAddNodes(nodes, { connectNow: req.body?.connectNow !== false });
      res.json({
        success: true,
        message: `${result.added.length} nœud(s) ajouté(s) dans tajcoin.conf`,
        ...result,
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });

  router.delete("/:node", requireLocalhostOperator, async (req, res) => {
    try {
      const result = await removeAddNode(decodeURIComponent(req.params.node || ""), {
        disconnectNow: req.body?.disconnectNow === true || req.query?.disconnect === "1",
      });
      res.json({
        success: true,
        message: `Nœud retiré de tajcoin.conf : ${result.removed}`,
        ...result,
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createLandingRouter, createTajcoinWalletRouter, createTajcoinNodesRouter, requireLocalhostOperator };
