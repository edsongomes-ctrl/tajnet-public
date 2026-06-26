"use strict";

const { getSession: getWalletSession } = require("./wallet-auth");
const { buildLocalPayOptions, executeTajPayment } = require("./taj-pay");
const { isLocalWalletAllowed } = require("./request-local");
const { getAccountBalance } = require("./wallet-accounts");

function walletSessionFromRequest(req) {
  const sessionId =
    req.headers["x-wallet-session"] ||
    req.headers["x-wallet-session-id"] ||
    req.body?.walletSessionId;
  return getWalletSession(sessionId);
}

function registerSessionPayRoutes(router, {
  getPendingSession,
  refreshSession,
  getPrice,
  commentPrefix,
  pendingError,
  completeField,
  isComplete,
  extraResponse = () => ({}),
}) {
  router.get("/pay-options", async (req, res) => {
    try {
      const allowLocal = isLocalWalletAllowed(req);
      const price = getPrice();
      const options = await buildLocalPayOptions(price, undefined, { allowLocal });
      const walletSession = walletSessionFromRequest(req);
      if (walletSession) {
        const balance = await getAccountBalance(
          walletSession.accountName,
          walletSession.allAddresses,
          walletSession.rpcProfile
        );
        options.wallet = {
          connected: true,
          balance,
          canPay: balance + 1e-8 >= price,
          address: walletSession.tajcoinAddress,
          account: walletSession.accountName,
        };
      }
      res.json({ success: true, ...options });
    } catch (err) {
      res.status(503).json({ success: false, error: err.message });
    }
  });

  router.post("/pay", async (req, res) => {
    const { sessionId, source = "auto" } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ success: false, error: "sessionId requis" });
    }

    const internal = getPendingSession(sessionId);
    if (!internal || internal.status !== "pending") {
      return res.status(400).json({ success: false, error: pendingError });
    }

    const walletSession = walletSessionFromRequest(req);
    const allowLocal = isLocalWalletAllowed(req);

    try {
      const { txid, paidVia } = await executeTajPayment({
        amount: internal.amount,
        toAddress: internal.paymentAddress,
        comment: `${commentPrefix} ${sessionId.slice(0, 8)}`,
        source,
        walletSession,
        allowLocal,
      });

      const session = await refreshSession(sessionId);
      res.json({
        success: true,
        txid,
        paidVia,
        [completeField]: isComplete(session),
        session,
        ...extraResponse(),
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
}

module.exports = { registerSessionPayRoutes, walletSessionFromRequest };
