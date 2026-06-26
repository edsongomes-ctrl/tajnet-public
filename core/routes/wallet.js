"use strict";

const express = require("express");
const {
  checkTajCoinAccount,
  createTajCoinAccount,
  getOrCreateTajCoinAccount,
  getAccountBalance,
  getAccountAddresses,
  getAccountTransactions,
  generateNewAddress,
  sendFromAddress,
  validateAddress,
  getNodeInfo,
  getLocalNodeWallet,
} = require("../lib/wallet-accounts");
const {
  createSession,
  getSession,
  destroySession,
  assertSignedPayload,
} = require("../lib/wallet-auth");
const {
  listRpcProfiles,
  parseRpcProfileFromRequest,
  sanitizeProfileForClient,
  testRpcProfile,
} = require("../lib/tajcoin");
const { isLocalWalletAllowed, LOCAL_WALLET_DENIED_MESSAGE } = require("../lib/request-local");

const router = express.Router();

function sessionFromRequest(req) {
  const sessionId =
    req.headers["x-wallet-session"] ||
    req.headers["x-wallet-session-id"] ||
    req.body?.sessionId;
  return getSession(sessionId);
}

function requireSession(req, res, next) {
  const session = sessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ success: false, error: "Session wallet invalide ou expirée" });
  }
  req.walletSession = session;
  next();
}

function rpcFromSession(session) {
  return session?.rpcProfile || { id: "local" };
}

async function buildWalletPayload(session) {
  const rpcProfile = rpcFromSession(session);
  const [balance, addresses, transactions, nodeInfo] = await Promise.all([
    getAccountBalance(session.accountName, session.allAddresses, rpcProfile),
    getAccountAddresses(session.accountName, rpcProfile),
    getAccountTransactions(session.accountName, 50, rpcProfile),
    getNodeInfo(rpcProfile),
  ]);

  session.allAddresses = addresses;
  if (addresses.length && !addresses.includes(session.tajcoinAddress)) {
    session.tajcoinAddress = addresses[0];
  }

  return {
    sessionId: session.sessionId,
    ethereumAddress: session.ethereumAddress,
    accountName: session.accountName,
    tajcoinAddress: session.tajcoinAddress,
    allAddresses: addresses,
    balance,
    transactions,
    blockHeight: nodeInfo.blocks || nodeInfo.blockcount || 0,
    nodeInfo,
    rpcProfile: sanitizeProfileForClient(session.rpcProfile),
  };
}

router.get("/rpc/profiles", (_req, res) => {
  res.json({ success: true, profiles: listRpcProfiles() });
});

router.post("/rpc/test", async (req, res) => {
  try {
    const rpcProfile = parseRpcProfileFromRequest(req.body);
    const result = await testRpcProfile(rpcProfile);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, connected: false, error: err.message });
  }
});

router.post("/auth/check-wallet", async (req, res) => {
  try {
    assertSignedPayload(req.body);
    const rpcProfile = parseRpcProfileFromRequest(req.body);
    const check = await checkTajCoinAccount(req.body.ethereumAddress, rpcProfile);
    res.json({
      success: true,
      walletExists: check.exists,
      accountName: check.accountName,
      addresses: check.addresses,
      rpcProfile: sanitizeProfileForClient(rpcProfile),
    });
  } catch (err) {
    res.status(err.message.includes("Signature") ? 401 : 400).json({
      success: false,
      error: err.message,
    });
  }
});

router.post("/auth/create-wallet", async (req, res) => {
  try {
    assertSignedPayload(req.body);
    const rpcProfile = parseRpcProfileFromRequest(req.body);
    const created = await createTajCoinAccount(req.body.ethereumAddress, rpcProfile);
    const session = createSession({
      ethereumAddress: req.body.ethereumAddress,
      accountName: created.accountName,
      tajcoinAddress: created.tajcoinAddress,
      allAddresses: created.allAddresses,
      rpcProfile,
    });

    res.json({
      success: true,
      sessionId: session.sessionId,
      accountName: session.accountName,
      tajcoinAddress: session.tajcoinAddress,
      allAddresses: session.allAddresses,
      rpcProfile: sanitizeProfileForClient(rpcProfile),
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    assertSignedPayload(req.body);
    const rpcProfile = parseRpcProfileFromRequest(req.body);
    const account = await getOrCreateTajCoinAccount(req.body.ethereumAddress, rpcProfile);
    const session = createSession({
      ethereumAddress: req.body.ethereumAddress,
      accountName: account.accountName,
      tajcoinAddress: account.tajcoinAddress,
      allAddresses: account.allAddresses,
      rpcProfile,
    });

    res.json({
      success: true,
      sessionId: session.sessionId,
      accountName: session.accountName,
      tajcoinAddress: session.tajcoinAddress,
      allAddresses: session.allAddresses,
      isNewAccount: account.isNewAccount,
      rpcProfile: sanitizeProfileForClient(rpcProfile),
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post("/auth/logout", (req, res) => {
  const session = sessionFromRequest(req);
  if (session) {
    destroySession(session.sessionId);
  }
  res.json({ success: true });
});

router.get("/auth/session", requireSession, async (req, res) => {
  try {
    const payload = await buildWalletPayload(req.walletSession);
    res.json({ success: true, ...payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/local", async (req, res) => {
  if (!isLocalWalletAllowed(req)) {
    return res.status(403).json({ success: false, error: LOCAL_WALLET_DENIED_MESSAGE });
  }
  try {
    const data = await getLocalNodeWallet({ id: "local" });
    res.json({ success: true, ...data, rpcProfile: { id: "local", label: "Nœud local" } });
  } catch (err) {
    res.status(503).json({ success: false, error: err.message });
  }
});

router.post("/local", async (req, res) => {
  if (!isLocalWalletAllowed(req)) {
    return res.status(403).json({ success: false, error: LOCAL_WALLET_DENIED_MESSAGE });
  }
  try {
    const rpcProfile = parseRpcProfileFromRequest(req.body);
    const data = await getLocalNodeWallet(rpcProfile);
    res.json({
      success: true,
      ...data,
      rpcProfile: sanitizeProfileForClient(rpcProfile),
    });
  } catch (err) {
    res.status(503).json({ success: false, error: err.message });
  }
});

router.get("/data", requireSession, async (req, res) => {
  try {
    const payload = await buildWalletPayload(req.walletSession);
    res.json({ success: true, ...payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/new-address", requireSession, async (req, res) => {
  try {
    const rpcProfile = rpcFromSession(req.walletSession);
    const address = await generateNewAddress(req.walletSession.accountName, rpcProfile);
    const addresses = await getAccountAddresses(req.walletSession.accountName, rpcProfile);
    req.walletSession.allAddresses = addresses;
    res.json({ success: true, address, allAddresses: addresses });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/send", requireSession, async (req, res) => {
  try {
    const { toAddress, amount, fromAddress, comment = "" } = req.body || {};
    const parsedAmount = Number(amount);
    const rpcProfile = rpcFromSession(req.walletSession);

    if (!toAddress || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, error: "Destinataire et montant requis" });
    }

    const validation = await validateAddress(toAddress, rpcProfile);
    if (!validation?.isvalid) {
      return res.status(400).json({ success: false, error: "Adresse destinataire invalide" });
    }

    const source = fromAddress || req.walletSession.tajcoinAddress;
    const txid = await sendFromAddress(
      req.walletSession.accountName,
      source,
      toAddress,
      parsedAmount,
      sanitizeComment(comment),
      rpcProfile
    );

    res.json({ success: true, txid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/validate-address", async (req, res) => {
  try {
    const { address } = req.body || {};
    if (!address) {
      return res.status(400).json({ success: false, error: "Adresse manquante" });
    }
    const rpcProfile = parseRpcProfileFromRequest(req.body);
    const result = await validateAddress(address, rpcProfile);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


function sanitizeComment(comment) {
  if (typeof comment !== "string") {
    return "";
  }
  return comment.trim().slice(0, 200);
}

module.exports = router;
