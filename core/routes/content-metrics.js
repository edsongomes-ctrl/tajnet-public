"use strict";

const express = require("express");
const { buildContentMetrics } = require("../lib/content-metrics");

function extractIpfsCid(pathname) {
  const segment = String(pathname || "")
    .replace(/^\/ipfs\//i, "")
    .replace(/^\//, "")
    .split(/[/?#]/)[0];
  return segment ? decodeURIComponent(segment) : null;
}

function createContentMetricsRouter({ metricsStore, contentPool }) {
  const router = express.Router();

  router.get("/status", (_req, res) => {
    res.json({ success: true, metrics: metricsStore?.status() || null });
  });

  router.get("/:contentCid", (req, res) => {
    const contentCid = req.params.contentCid;
    if (!contentCid) {
      return res.status(400).json({ success: false, error: "contentCid requis" });
    }
    const views = metricsStore?.getViewCount(contentCid) ?? 0;
    const metrics = buildContentMetrics(contentCid, { contentPool, metricsStore });
    res.json({
      success: true,
      contentCid,
      views,
      metrics,
    });
  });

  return router;
}

module.exports = { createContentMetricsRouter, extractIpfsCid };
