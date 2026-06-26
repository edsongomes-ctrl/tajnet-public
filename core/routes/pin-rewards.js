"use strict";

const express = require("express");
const { getSession } = require("../lib/wallet-auth");
const { settlePinReward } = require("../lib/pin-rewards");
const { PIN_REWARD_PER_CLAIM } = require("../lib/content-pool");
const { checkOpportunistClaimEligibility } = require("../lib/opportunist-claim");

function walletSessionFromRequest(req) {
  const sessionId =
    req.headers["x-wallet-session"] ||
    req.headers["x-wallet-session-id"] ||
    req.body?.sessionId;
  return getSession(sessionId);
}

function resolveClaimAddress(req) {
  const bodyAddress = String(req.body?.claimAddress || "").trim();
  if (bodyAddress) {
    return bodyAddress;
  }
  const session = walletSessionFromRequest(req);
  return session?.tajcoinAddress || null;
}

function createPinRewardsRouter({ ledger, discover, contentPool, metricsStore }) {
  const router = express.Router();

  router.get("/status", (_req, res) => {
    res.json({
      success: true,
      ...ledger.status(),
      contentPool: contentPool?.status() || null,
      rewardPerClaim: PIN_REWARD_PER_CLAIM,
      claimRule: "0,5 TAJ par réclamation répartis : 25 % contributeur, 25 % lecteur, 25 % hébergeur, 25 % investisseur (réserve si absent)",
    });
  });

  router.get("/pool/:contentCid", (req, res) => {
    const pool = contentPool?.getPool(req.params.contentCid);
    if (!pool) {
      return res.status(404).json({ success: false, error: "Cagnotte introuvable" });
    }
    const claimAddress = String(req.query.claimAddress || "").trim();
    const eligibility = claimAddress
      ? checkOpportunistClaimEligibility(req.params.contentCid, claimAddress, {
          discover,
          metricsStore,
          contentPool,
        })
      : null;
    res.json({
      success: true,
      pool,
      claimedByAddress: claimAddress ? contentPool.hasClaimed(req.params.contentCid, claimAddress) : false,
      rewardPerClaim: PIN_REWARD_PER_CLAIM,
      eligibility,
    });
  });

  router.post("/claim", async (req, res) => {
    try {
      const { contentCid, sourceTxid } = req.body || {};
      const claimAddress = resolveClaimAddress(req);
      if (!contentCid || !claimAddress) {
        return res.status(400).json({
          success: false,
          error: "contentCid et claimAddress requis (connectez MetaMask ou passez claimAddress)",
        });
      }

      const eligibility = checkOpportunistClaimEligibility(contentCid, claimAddress, {
        discover,
        metricsStore,
        contentPool,
      });
      if (!eligibility.eligible) {
        return res.status(400).json({
          success: false,
          error: eligibility.reason,
          eligibility,
        });
      }

      let entry = sourceTxid ? discover.getEntry(sourceTxid) : null;
      if (!entry) {
        entry =
          Object.values(discover.index.entries || {}).find((e) => e.contentCid === contentCid) || null;
      }
      if (entry) {
        entry = await discover.enrichEntry(entry);
        discover.applyMetadataEconomics(entry);
      } else {
        entry = {
          contentCid,
          txid: sourceTxid,
          metadata: { contentCid },
        };
      }

      const claim = {
        claimAddress,
        pinRewardTaj: PIN_REWARD_PER_CLAIM,
      };

      const settlement = await settlePinReward({ entry, claim }, ledger, contentPool);

      res.json({
        success: settlement.status === "paid",
        settlement,
        eligibility: checkOpportunistClaimEligibility(contentCid, claimAddress, {
          discover,
          metricsStore,
          contentPool,
        }),
        pool: contentPool?.getPool(contentCid) || null,
        entry: { contentCid, txid: entry.txid || null },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createPinRewardsRouter, resolveClaimAddress, walletSessionFromRequest };
