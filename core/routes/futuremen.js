"use strict";

const express = require("express");
const { buildFuturemenFeed } = require("../lib/futuremen-feed");
const { getRequestOrigin } = require("../lib/ipfs-gateway");

function createFuturemenRouter(discover) {
  const router = express.Router();

  router.get("/feed", async (req, res) => {
    try {
      const feed = await buildFuturemenFeed(discover, {
        clientOrigin: getRequestOrigin(req),
      });
      res.json({ success: true, ...feed });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createFuturemenRouter };
