"use strict";

const express = require("express");
const { loadPluginHandler } = require("../lib/plugins");
const { registerSessionPayRoutes } = require("../lib/pay-routes");
const { resolveClaimAddress } = require("./pin-rewards");
const { requireNonWanOperator } = require("../lib/request-local");

function createBranWebRouter({ pluginsDir, branPublishService = null } = {}) {
  const router = express.Router();

  function handler() {
    return loadPluginHandler(pluginsDir, "bran-web");
  }

  router.get("/status", (_req, res) => {
    const h = handler();
    if (!h?.status) {
      return res.status(501).json({ success: false, error: "Plugin bran-web indisponible" });
    }
    res.json({
      success: true,
      branWeb: {
        ...h.status(),
        publish: branPublishService?.status() || null,
      },
    });
  });

  router.get("/workflow", (_req, res) => {
    const h = handler();
    if (!h?.readWorkflow) {
      return res.status(501).json({ success: false, error: "Plugin bran-web indisponible" });
    }
    const content = h.readWorkflow();
    if (content == null) {
      return res.status(404).json({ success: false, error: "workflow-bran.md introuvable" });
    }
    res.json({ success: true, workflow: content, branWeb: h.status() });
  });

  router.put("/workflow", requireNonWanOperator, (req, res) => {
    try {
      const h = handler();
      if (!h?.writeWorkflow) {
        return res.status(501).json({ success: false, error: "Plugin bran-web indisponible" });
      }
      const workflow = req.body?.workflow;
      const saved = h.writeWorkflow(workflow);
      res.json({ success: true, workflow: saved, branWeb: h.status() });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post("/generate", requireNonWanOperator, async (req, res) => {
    try {
      const h = handler();
      if (!h?.generate) {
        return res.status(501).json({ success: false, error: "Plugin bran-web indisponible" });
      }
      const check = Boolean(req.body?.check);
      const result = await h.generate({ check });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  if (branPublishService) {
    const publishRouter = express.Router();

    publishRouter.post("/request", async (req, res) => {
      try {
        const { html, title } = req.body || {};
        const publisherAddress = resolveClaimAddress(req);
        if (!publisherAddress) {
          return res.status(400).json({
            success: false,
            error: "Connectez MetaMask pour publier sur IPFS et Tajcoin",
          });
        }
        const session = await branPublishService.createRequest({
          html,
          title,
          publisherAddress,
        });
        res.json({
          success: true,
          session,
          publish: branPublishService.status(),
        });
      } catch (err) {
        res.status(400).json({ success: false, error: err.message });
      }
    });

    publishRouter.get("/session/:sessionId", (req, res) => {
      const session = branPublishService.publicSession(
        branPublishService.getSession(req.params.sessionId)
      );
      if (!session) {
        return res.status(404).json({ success: false, error: "Session introuvable" });
      }
      res.json({ success: true, session });
    });

    publishRouter.post("/session/:sessionId/check", async (req, res) => {
      try {
        const session = await branPublishService.refreshSession(req.params.sessionId, req);
        if (!session) {
          return res.status(404).json({ success: false, error: "Session introuvable" });
        }
        res.json({
          success: true,
          completed: session.status === "completed",
          session,
          publish: branPublishService.status(),
        });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    registerSessionPayRoutes(publishRouter, {
      getPendingSession: (sessionId) => branPublishService.getSession(sessionId),
      refreshSession: (sessionId) => branPublishService.refreshSession(sessionId, null),
      getPrice: () => branPublishService.getPrice(),
      commentPrefix: "BranWeb",
      pendingError: "Aucune session publication Bran Web en attente",
      completeField: "completed",
      isComplete: (session) => session?.status === "completed",
      extraResponse: () => ({ publish: branPublishService.status() }),
    });

    router.use("/publish", publishRouter);
  }

  return router;
}

module.exports = { createBranWebRouter };
