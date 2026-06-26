"use strict";

const express = require("express");
const { registerSessionPayRoutes } = require("../lib/pay-routes");

function createPinServiceRouter(pinService) {
  const router = express.Router();

  router.get("/status", (_req, res) => {
    res.json({ success: true, pinService: pinService.status() });
  });

  router.post("/request", async (req, res) => {
    try {
      const { contentCid, title, sourceTxid } = req.body || {};
      const session = await pinService.createRequest({ contentCid, title, sourceTxid });
      res.json({ success: true, session, pinService: pinService.status() });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get("/session/:sessionId", (req, res) => {
    const session = pinService.publicSession(pinService.getSession(req.params.sessionId));
    if (!session) {
      return res.status(404).json({ success: false, error: "Session introuvable" });
    }
    res.json({ success: true, session });
  });

  router.post("/session/:sessionId/check", async (req, res) => {
    try {
      const session = await pinService.refreshSession(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: "Session introuvable" });
      }
      res.json({
        success: true,
        completed: session.status === "completed",
        session,
        pinService: pinService.status(),
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  registerSessionPayRoutes(router, {
    getPendingSession: (sessionId) => pinService.getSession(sessionId),
    refreshSession: (sessionId) => pinService.refreshSession(sessionId),
    getPrice: () => pinService.getPrice(),
    commentPrefix: "Pin",
    pendingError: "Aucune session pinning en attente de paiement",
    completeField: "completed",
    isComplete: (session) => session?.status === "completed",
    extraResponse: () => ({ pinService: pinService.status() }),
  });

  return router;
}

module.exports = { createPinServiceRouter };
