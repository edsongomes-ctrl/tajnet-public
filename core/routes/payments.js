"use strict";

const express = require("express");
const { GUARD_PRICE_TAJ } = require("../lib/guard");
const { initAnnounce } = require("../lib/announce");
const {
  buildLocalPayOptions,
  fundSystemAccount,
  listFundableAccounts,
} = require("../lib/taj-pay");
const { walletSessionFromRequest } = require("../lib/pay-routes");
const { isLocalWalletAllowed, isLocalhostRequest } = require("../lib/request-local");

function createPaymentsRouter({ guard, pinService, stakeService } = {}) {
  const router = express.Router();

  router.get("/services", async (_req, res) => {
    try {
      const announce = await initAnnounce();
      const services = [
        {
          id: "guard",
          type: "session",
          label: "Guard Daemon",
          apiBase: "/api/guard",
          price: GUARD_PRICE_TAJ,
          description: "Déverrouille upload IPFS, publish et indexation Super CV",
        },
        {
          id: "pin",
          type: "session",
          label: "Pinning payant",
          apiBase: "/api/pin-service",
          price: pinService?.getPrice?.() ?? null,
          description: "Épingle un CID sur ce nœud",
        },
        {
          id: "stake",
          type: "session",
          label: "Staking contenu",
          apiBase: "/api/content-staking",
          price: stakeService?.status?.()?.minStakeTaj ?? null,
          description: "Investir des TAJ sur un contenu pour une durée donnée",
        },
        ...listFundableAccounts().map((entry) => ({
          id: entry.account,
          type: "fund",
          label: entry.label,
          apiBase: "/api/payments",
          fundAccount: entry.account,
          price: entry.suggestedAmount,
          description: `Alimente le compte nœud ${entry.account}`,
          balanceTaj: entry.account === announce.account ? announce.balanceTaj : null,
          address: entry.account === announce.account ? announce.address : null,
        })),
      ];

      res.json({
        success: true,
        services,
        guard: guard?.status?.() || null,
        pinService: pinService?.status?.() || null,
        announce: announce.enabled ? announce : null,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get("/options", async (req, res) => {
    try {
      const allowLocal = isLocalWalletAllowed(req);
      const options = await buildLocalPayOptions(0, undefined, { allowLocal });
      const walletSession = walletSessionFromRequest(req);
      if (walletSession) {
        const { getAccountBalance } = require("../lib/wallet-accounts");
        const balance = await getAccountBalance(
          walletSession.accountName,
          walletSession.allAddresses,
          walletSession.rpcProfile
        );
        options.wallet = {
          connected: true,
          balance,
          address: walletSession.tajcoinAddress,
          account: walletSession.accountName,
        };
      }
      res.json({ success: true, ...options });
    } catch (err) {
      res.status(503).json({ success: false, error: err.message });
    }
  });

  router.post("/fund", async (req, res) => {
    const { account, amount, source = "auto" } = req.body || {};
    if (!account) {
      return res.status(400).json({ success: false, error: "account requis" });
    }

    const walletSession = walletSessionFromRequest(req);
    const allowLocal = isLocalhostRequest(req);

    try {
      const fundable = listFundableAccounts().find((entry) => entry.account === account);
      const parsedAmount = Number(amount ?? fundable?.suggestedAmount ?? 1);
      const result = await fundSystemAccount({
        accountName: account,
        amount: parsedAmount,
        comment: `Fund ${account}`,
        source,
        walletSession,
        allowLocal,
      });

      const announce = account === "tajannounce" ? await initAnnounce() : null;

      res.json({
        success: true,
        ...result,
        announce,
      });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({
        success: false,
        error: err.message,
        ...(err.details || {}),
      });
    }
  });

  return router;
}

module.exports = { createPaymentsRouter };
