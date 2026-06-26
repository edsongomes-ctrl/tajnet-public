"use strict";

const {
  DEFAULT_ACCOUNT,
  getLocalNodeWallet,
  getAccountBalance,
  getAccountAddresses,
  sendFromAccount,
  sendFromAddress,
} = require("./wallet-accounts");
const { LOCAL_PROFILE, tajcoinRpc } = require("./tajcoin");

const FUNDABLE_ACCOUNTS = {
  tajannounce: {
    label: "Annonces blockchain",
    suggestedAmount: Number(process.env.ANNOUNCE_FUND_TAJ || 1),
  },
  tajpanel: {
    label: "Compte panel nœud",
    suggestedAmount: Number(process.env.TAJPANEL_FUND_TAJ || 1),
  },
};

function payError(message, status, details) {
  const err = new Error(message);
  err.status = status;
  err.details = details;
  return err;
}

async function buildLocalPayOptions(price, rpcProfile = LOCAL_PROFILE, { allowLocal = true } = {}) {
  if (!allowLocal) {
    return {
      price,
      local: {
        available: false,
        canPay: false,
        requiresMetamask: true,
      },
    };
  }

  const local = await getLocalNodeWallet(rpcProfile);
  return {
    price,
    local: {
      available: true,
      account: local.accountName,
      address: local.tajcoinAddress,
      balance: local.balance,
      canPay: local.balance + 1e-8 >= price,
    },
  };
}

async function executeTajPayment({
  amount,
  toAddress,
  comment,
  source = "auto",
  walletSession = null,
  rpcProfile = LOCAL_PROFILE,
  allowLocal = true,
}) {
  async function payWithWallet() {
    if (!walletSession) {
      throw payError("Session wallet requise — connectez MetaMask", 401);
    }
    const balance = await getAccountBalance(
      walletSession.accountName,
      walletSession.allAddresses,
      walletSession.rpcProfile
    );
    if (balance + 1e-8 < amount) {
      throw payError("Solde wallet insuffisant", 402, {
        balance,
        required: amount,
        source: "wallet",
      });
    }
    const txid = await sendFromAddress(
      walletSession.accountName,
      walletSession.tajcoinAddress,
      toAddress,
      amount,
      comment,
      walletSession.rpcProfile
    );
    return { txid, paidVia: "wallet" };
  }

  async function payWithLocal() {
    if (!allowLocal) {
      throw payError("Paiement nœud local indisponible depuis ce poste — connectez MetaMask", 403);
    }
    const local = await getLocalNodeWallet(rpcProfile);
    if (local.balance + 1e-8 < amount) {
      throw payError(`Solde insuffisant sur le compte « ${DEFAULT_ACCOUNT} »`, 402, {
        balance: local.balance,
        required: amount,
        source: "local",
        account: local.accountName,
        address: local.tajcoinAddress,
      });
    }
    const txid = await sendFromAccount(DEFAULT_ACCOUNT, toAddress, amount, comment, rpcProfile);
    return { txid, paidVia: "local" };
  }

  if (source === "wallet") {
    return payWithWallet();
  }
  if (source === "local") {
    return payWithLocal();
  }

  if (walletSession) {
    const balance = await getAccountBalance(
      walletSession.accountName,
      walletSession.allAddresses,
      walletSession.rpcProfile
    );
    if (balance + 1e-8 >= amount) {
      return payWithWallet();
    }
    if (!allowLocal) {
      throw payError("Solde Tajcoin insuffisant sur votre wallet MetaMask", 402, {
        balance,
        required: amount,
        source: "wallet",
        address: walletSession.tajcoinAddress,
        account: walletSession.accountName,
      });
    }
  }

  if (!allowLocal) {
    throw payError("Session wallet requise — connectez MetaMask via /wallet/login", 401);
  }

  return payWithLocal();
}

async function getAccountReceiveAddress(accountName, rpcProfile = LOCAL_PROFILE) {
  let addresses = await getAccountAddresses(accountName, rpcProfile);
  if (!addresses.length) {
    const address = await tajcoinRpc("getnewaddress", [accountName], rpcProfile);
    return address;
  }
  return addresses[0];
}

async function fundSystemAccount({
  accountName,
  amount,
  comment = "",
  source = "auto",
  walletSession = null,
  rpcProfile = LOCAL_PROFILE,
  allowLocal = true,
}) {
  if (!FUNDABLE_ACCOUNTS[accountName]) {
    throw payError(`Compte « ${accountName} » non autorisé pour l'alimentation`, 403);
  }
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw payError("Montant invalide", 400);
  }

  const toAddress = await getAccountReceiveAddress(accountName, rpcProfile);
  const payment = await executeTajPayment({
    amount: parsedAmount,
    toAddress,
    comment: comment || `Fund ${accountName}`,
    source,
    walletSession,
    rpcProfile,
    allowLocal,
  });

  return {
    ...payment,
    account: accountName,
    toAddress,
    amount: parsedAmount,
  };
}

function listFundableAccounts() {
  return Object.entries(FUNDABLE_ACCOUNTS).map(([account, meta]) => ({
    account,
    ...meta,
  }));
}

module.exports = {
  FUNDABLE_ACCOUNTS,
  buildLocalPayOptions,
  executeTajPayment,
  fundSystemAccount,
  listFundableAccounts,
};
