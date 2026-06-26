"use strict";

const express = require("express");
const { GUARD_PRICE_TAJ } = require("../lib/guard");
const { registerSessionPayRoutes } = require("../lib/pay-routes");
const { requireLocalhostOperator } = require("../lib/request-local");

function createGuardRouter(guard) {
  const router = express.Router();

  router.get("/status", (_req, res) => {
    res.json({ success: true, guard: guard.status() });
  });

  router.get("/active-session", requireLocalhostOperator, (_req, res) => {
    const session = guard.getActiveUnlockedSession();
    if (!session) {
      return res.status(404).json({
        success: false,
        error: "Aucune session Guard déverrouillée — payez dans TajPanel d'abord",
        guard: guard.status(),
      });
    }
    res.json({
      success: true,
      session: guard.publicSession(session),
      guard: guard.status(),
    });
  });

  router.post("/session", async (_req, res) => {
    try {
      const session = await guard.createPaymentSession();
      res.json({ success: true, session, guard: guard.status() });
    } catch (err) {
      res.status(503).json({ success: false, error: err.message });
    }
  });

  router.get("/session/:sessionId", async (req, res) => {
    try {
      const session = await guard.refreshSession(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: "Session introuvable ou expirée" });
      }
      res.json({ success: true, session, guard: guard.status() });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post("/check", async (req, res) => {
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ success: false, error: "sessionId requis" });
    }

    try {
      const session = await guard.refreshSession(sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: "Session introuvable ou expirée" });
      }
      res.json({
        success: true,
        unlocked: session.status === "unlocked",
        session,
        guard: guard.status(),
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post("/lock", (req, res) => {
    const { sessionId } = req.body || {};
    if (sessionId) {
      guard.lockSession(sessionId);
    } else {
      guard.lockAll();
    }
    res.json({ success: true, guard: guard.status() });
  });

  router.get("/config", (_req, res) => {
    res.json({
      success: true,
      price: GUARD_PRICE_TAJ,
      guard: guard.status(),
    });
  });

  registerSessionPayRoutes(router, {
    getPendingSession: (sessionId) => guard.getSession(sessionId),
    refreshSession: (sessionId) => guard.refreshSession(sessionId),
    getPrice: () => GUARD_PRICE_TAJ,
    commentPrefix: "Guard",
    pendingError: "Aucune session Guard en attente de paiement",
    completeField: "unlocked",
    isComplete: (session) => session?.status === "unlocked",
    extraResponse: () => ({ guard: guard.status() }),
  });

  return router;
}

function requireGuardSession(guard) {
  return (req, res, next) => {
    if (guard.isBypassed()) {
      return next();
    }

    const sessionId =
      req.headers["x-guard-session"] ||
      req.headers["x-guard-session-id"] ||
      req.body?.guardSessionId;

    if (guard.isSessionValid(sessionId)) {
      req.guardSessionId = sessionId;
      return next();
    }

    res.status(402).json({
      error: "Porte d'entrée verrouillée",
      message: "Session Guard requise — cliquez « Payer » pour déverrouiller sans quitter la page.",
      price: GUARD_PRICE_TAJ,
      guard: guard.status(),
    });
  };
}

module.exports = { createGuardRouter, requireGuardSession };
