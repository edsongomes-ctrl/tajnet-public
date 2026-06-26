"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const { buildPulseRegistry } = require("../lib/pulse-registry");
const { getRequestOrigin } = require("../lib/ipfs-gateway");
const { requireNonWanOperator } = require("../lib/request-local");

function resolveRootDir() {
  const dockerRoot = path.join(__dirname, "..");
  if (fs.existsSync(path.join(dockerRoot, "panel", "pulse"))) return dockerRoot;
  return path.join(__dirname, "..", "..");
}

function createPulseRouter(discover) {
  const router = express.Router();

  router.get("/nodes", requireNonWanOperator, async (req, res) => {
    try {
      const registry = await buildPulseRegistry(discover, {
        clientOrigin: getRequestOrigin(req),
        dataDir: process.env.TAJNET_DATA_DIR,
        rootDir: process.env.TAJNET_ROOT || resolveRootDir(),
      });
      res.json({ success: true, ...registry });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createPulseRouter };
