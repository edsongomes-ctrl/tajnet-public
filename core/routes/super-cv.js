"use strict";

const express = require("express");
const { loadPluginHandler } = require("../lib/plugins");
const { buildClientIpfsUrls, clientGatewayBase } = require("../lib/ipfs-gateway");
const { registerSessionPayRoutes } = require("../lib/pay-routes");
const { resolveClaimAddress } = require("./pin-rewards");

function resolveProfile(cvIndex, id) {
  const key = String(id || "").trim();
  if (!key) return null;

  const match = (entry) =>
    entry.id === key ||
    entry.txid === key ||
    (entry.txid && entry.txid.startsWith(key)) ||
    entry.contentCid === key ||
    (entry.id && entry.id.startsWith(key));

  const fromCorpus = cvIndex.allSearchableEntries().find(match);
  if (fromCorpus) return fromCorpus;

  const local = cvIndex.get(key);
  return local || null;
}

function buildFiche(entry, { req, cvAccess, recruiterAddress }) {
  const profileId = entry.id || entry.txid;
  const contentCid = entry.contentCid || null;
  const hasIpfsContent = Boolean(contentCid);
  const unlocked =
    hasIpfsContent &&
    cvAccess?.hasAccess(profileId, recruiterAddress);

  const base = {
    id: profileId,
    title: entry.title || "Profil CV",
    skills: entry.skills || [],
    keywords: entry.keywords || [],
    matchedSkills: entry.matchedSkills || [],
    score: entry.score ?? null,
    source: entry.source || "local",
    txid: entry.txid || null,
    metadataCid: entry.metadataCid || null,
    blockHeight: entry.blockHeight ?? null,
    indexedAt: entry.indexedAt || null,
    tokenCount: entry.tokenCount ?? null,
    hasIpfsContent,
    contentUnlocked: unlocked,
    contentCid: unlocked ? contentCid : null,
    access: {
      enabled: cvAccess?.isEnabled() ?? false,
      price: cvAccess?.getPrice() ?? 0,
      account: cvAccess?.status?.()?.account || "tajcv",
      recruiterConnected: Boolean(recruiterAddress),
    },
  };

  if (unlocked && contentCid) {
    Object.assign(base, buildClientIpfsUrls(contentCid, req));
  }

  return base;
}

function createSuperCvRouter(cvIndex, { pluginsDir, cvAccess = null } = {}) {
  const router = express.Router();

  router.get("/status", (_req, res) => {
    res.json({
      success: true,
      superCv: cvIndex.status(),
      cvAccess: cvAccess?.status() || null,
    });
  });

  router.get("/skills", (_req, res) => {
    const handler = loadPluginHandler(pluginsDir, "super-cv");
    res.json({ success: true, skills: handler?.KNOWN_SKILLS || [] });
  });

  router.get("/entries", (_req, res) => {
    const entries = cvIndex.allSearchableEntries();
    res.json({ success: true, total: entries.length, entries });
  });

  router.get("/entries/:id", (req, res) => {
    const entry = resolveProfile(cvIndex, req.params.id);
    if (!entry) {
      return res.status(404).json({ success: false, error: "CV introuvable" });
    }
    res.json({ success: true, entry });
  });

  router.get("/fiche", (req, res) => {
    const id = String(req.query.id || req.query.txid || "").trim();
    if (!id) {
      return res.status(400).json({ success: false, error: "Paramètre id ou txid requis" });
    }

    const entry = resolveProfile(cvIndex, id);
    if (!entry) {
      return res.status(404).json({ success: false, error: "Profil CV introuvable" });
    }

    const recruiterAddress = resolveClaimAddress(req);
    const fiche = buildFiche(entry, { req, cvAccess, recruiterAddress });

    res.json({
      success: true,
      gateway: clientGatewayBase(req),
      fiche,
    });
  });

  router.get("/search", (req, res) => {
    const q = req.query.q || "";
    const skills = req.query.skills || "";
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const result = cvIndex.search({ q, skills, limit });
    const results = (result.results || []).map((entry) => ({
      id: entry.id,
      title: entry.title,
      skills: entry.skills,
      matchedSkills: entry.matchedSkills,
      score: entry.score,
      source: entry.source,
      txid: entry.txid,
      indexedAt: entry.indexedAt,
      hasContent: Boolean(entry.contentCid),
      ficheUrl: `/cv?id=${encodeURIComponent(entry.id || entry.txid)}`,
    }));
    res.json({
      success: true,
      gateway: clientGatewayBase(req),
      ...result,
      results,
    });
  });

  const accessRouter = express.Router();

  accessRouter.post("/request", async (req, res) => {
    try {
      const profileId = String(req.body?.profileId || req.body?.id || "").trim();
      const recruiterAddress = resolveClaimAddress(req);
      const entry = resolveProfile(cvIndex, profileId);

      if (!entry?.contentCid) {
        return res.status(404).json({ success: false, error: "CV ou contenu IPFS introuvable" });
      }
      if (!recruiterAddress) {
        return res.status(400).json({
          success: false,
          error: "Connectez MetaMask pour débloquer la consultation",
        });
      }

      if (cvAccess.hasAccess(entry.id || profileId, recruiterAddress)) {
        return res.json({
          success: true,
          alreadyUnlocked: true,
          fiche: buildFiche(entry, { req, cvAccess, recruiterAddress }),
        });
      }

      const session = await cvAccess.createRequest({
        profileId: entry.id || profileId,
        contentCid: entry.contentCid,
        title: entry.title,
        recruiterAddress,
      });
      res.json({ success: true, session, cvAccess: cvAccess.status() });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  accessRouter.get("/check/:profileId", (req, res) => {
    const recruiterAddress = resolveClaimAddress(req);
    const entry = resolveProfile(cvIndex, req.params.profileId);
    if (!entry) {
      return res.status(404).json({ success: false, error: "Profil introuvable" });
    }
    const unlocked = cvAccess.hasAccess(entry.id || req.params.profileId, recruiterAddress);
    res.json({
      success: true,
      unlocked,
      recruiterAddress: recruiterAddress || null,
      fiche: buildFiche(entry, { req, cvAccess, recruiterAddress }),
    });
  });

  accessRouter.get("/session/:sessionId", (req, res) => {
    const session = cvAccess.publicSession(cvAccess.getSession(req.params.sessionId));
    if (!session) {
      return res.status(404).json({ success: false, error: "Session introuvable" });
    }
    res.json({ success: true, session });
  });

  accessRouter.post("/session/:sessionId/check", async (req, res) => {
    try {
      const session = await cvAccess.refreshSession(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: "Session introuvable" });
      }
      res.json({
        success: true,
        completed: session.status === "completed",
        session,
        cvAccess: cvAccess.status(),
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  registerSessionPayRoutes(accessRouter, {
    getPendingSession: (sessionId) => cvAccess.getSession(sessionId),
    refreshSession: (sessionId) => cvAccess.refreshSession(sessionId),
    getPrice: () => cvAccess.getPrice(),
    commentPrefix: "CV",
    pendingError: "Aucune session consultation CV en attente de paiement",
    completeField: "completed",
    isComplete: (session) => session?.status === "completed",
    extraResponse: () => ({ cvAccess: cvAccess.status() }),
  });

  router.use("/access", accessRouter);

  return router;
}

module.exports = { createSuperCvRouter, resolveProfile, buildFiche };
