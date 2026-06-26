"use strict";

const express = require("express");
const { registerSessionPayRoutes } = require("../lib/pay-routes");
const { resolveClaimAddress } = require("./pin-rewards");
const { STAKE_PERIODS, STAKE_MIN_TAJ, previewStakeYield } = require("../lib/content-staking");
const { buildContentMetrics } = require("../lib/content-metrics");

function createContentStakingRouter({ stakeService, stakingLedger, contentPool, metricsStore }) {
  const router = express.Router();

  router.get("/status", (_req, res) => {
    res.json({
      success: true,
      staking: stakingLedger?.status() || null,
      stakeService: stakeService?.status() || null,
      periods: STAKE_PERIODS,
      minStakeTaj: STAKE_MIN_TAJ,
    });
  });

  router.get("/content/:contentCid", (req, res) => {
    const contentCid = req.params.contentCid;
    const summary = stakingLedger?.summaryForContent(contentCid, { contentPool, metricsStore });
    if (!summary) {
      return res.status(404).json({ success: false, error: "Contenu introuvable" });
    }
    res.json({ success: true, ...summary });
  });

  router.post("/preview", (req, res) => {
    try {
      const { contentCid, amount, periodId = "1m" } = req.body || {};
      if (!contentCid || !amount) {
        return res.status(400).json({ success: false, error: "contentCid et amount requis" });
      }
      const metrics = buildContentMetrics(contentCid, { contentPool, metricsStore });
      const preview = previewStakeYield({ amount, periodId }, metrics, metrics.score);
      res.json({ success: true, metrics, preview, periods: STAKE_PERIODS });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post("/request", async (req, res) => {
    try {
      const { contentCid, amount, periodId = "1m" } = req.body || {};
      const stakerAddress = resolveClaimAddress(req);
      if (!contentCid || !stakerAddress) {
        return res.status(400).json({
          success: false,
          error: "contentCid et stakerAddress requis (connectez MetaMask)",
        });
      }
      const session = await stakeService.createRequest({
        contentCid,
        stakerAddress,
        amount,
        periodId,
      });
      res.json({ success: true, session, stakeService: stakeService.status() });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get("/session/:sessionId", (req, res) => {
    const session = stakeService.publicSession(stakeService.getSession(req.params.sessionId));
    if (!session) {
      return res.status(404).json({ success: false, error: "Session introuvable" });
    }
    res.json({ success: true, session });
  });

  router.post("/session/:sessionId/check", async (req, res) => {
    try {
      const session = await stakeService.refreshSession(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: "Session introuvable" });
      }
      res.json({
        success: true,
        completed: session.status === "completed",
        session,
        stakeService: stakeService.status(),
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get("/stakes", (req, res) => {
    const contentCid = req.query.contentCid || null;
    const stakerAddress = resolveClaimAddress(req) || req.query.stakerAddress || null;
    let stakes = [];
    if (contentCid) {
      stakes = stakingLedger.listByContent(contentCid).map((s) => stakingLedger.publicStake(s));
    } else if (stakerAddress) {
      stakes = stakingLedger.listByStaker(stakerAddress).map((s) => stakingLedger.publicStake(s));
    } else {
      stakes = stakingLedger.listAll().map((s) => stakingLedger.publicStake(s));
    }
    res.json({ success: true, stakes });
  });

  registerSessionPayRoutes(router, {
    getPendingSession: (sessionId) => stakeService.getSession(sessionId),
    refreshSession: (sessionId) => stakeService.refreshSession(sessionId),
    getPrice: () => STAKE_MIN_TAJ,
    commentPrefix: "Stake",
    pendingError: "Aucune session staking en attente de paiement",
    completeField: "completed",
    isComplete: (session) => session?.status === "completed",
    extraResponse: () => ({ stakeService: stakeService.status() }),
  });

  return router;
}

module.exports = { createContentStakingRouter };
