"use strict";

const express = require("express");
const { announceConfig, initAnnounce } = require("../lib/announce");

function createAnnounceRouter() {
  const router = express.Router();

  router.get("/config", (_req, res) => {
    res.json({ success: true, announce: announceConfig() });
  });

  router.get("/status", async (_req, res) => {
    const status = await initAnnounce();
    res.json({ success: true, announce: status });
  });

  return router;
}

module.exports = { createAnnounceRouter };
