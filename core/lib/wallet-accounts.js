"use strict";

const crypto = require("crypto");
const { LOCAL_PROFILE, tajcoinRpc } = require("./tajcoin");

const DEFAULT_ACCOUNT = process.env.TAJNET_WALLET_ACCOUNT || "tajpanel";

function generateAccountName(ethereumAddress) {
  const hash = crypto
    .createHash("sha256")
    .update(ethereumAddress.toLowerCase())
    .digest("hex")
    .substring(0, 16);
  return `user_${hash}`;
}

async function getAccountAddresses(accountName, rpcProfile = LOCAL_PROFILE) {
  try {
    const addresses = await tajcoinRpc("getaddressesbyaccount", [accountName], rpcProfile);
    return Array.isArray(addresses) ? addresses : [];
  } catch {
    return [];
  }
}

async function checkTajCoinAccount(ethereumAddress, rpcProfile = LOCAL_PROFILE) {
  const accountName = generateAccountName(ethereumAddress);
  const addresses = await getAccountAddresses(accountName, rpcProfile);
  return {
    exists: addresses.length > 0,
    accountName,
    addresses,
  };
}

async function createTajCoinAccount(ethereumAddress, rpcProfile = LOCAL_PROFILE) {
  const accountName = generateAccountName(ethereumAddress);
  const existing = await checkTajCoinAccount(ethereumAddress, rpcProfile);
  if (existing.exists) {
    throw new Error("Un wallet existe déjà pour cette adresse Ethereum");
  }

  const tajcoinAddress = await tajcoinRpc("getnewaddress", [accountName], rpcProfile);
  return {
    accountName,
    tajcoinAddress,
    allAddresses: [tajcoinAddress],
  };
}

async function getOrCreateTajCoinAccount(ethereumAddress, rpcProfile = LOCAL_PROFILE) {
  const accountName = generateAccountName(ethereumAddress);
  let addresses = await getAccountAddresses(accountName, rpcProfile);

  if (addresses.length === 0) {
    const tajcoinAddress = await tajcoinRpc("getnewaddress", [accountName], rpcProfile);
    return {
      accountName,
      tajcoinAddress,
      isNewAccount: true,
      allAddresses: [tajcoinAddress],
    };
  }

  return {
    accountName,
    tajcoinAddress: addresses[0],
    isNewAccount: false,
    allAddresses: addresses,
  };
}

async function getAccountBalance(accountName, knownAddresses = null, rpcProfile = LOCAL_PROFILE) {
  let accountAddresses = knownAddresses?.length
    ? knownAddresses
    : await getAccountAddresses(accountName, rpcProfile);

  if (!accountAddresses.length) {
    return 0;
  }

  let totalReceived = 0;
  for (const address of accountAddresses) {
    try {
      const received = await tajcoinRpc("getreceivedbyaddress", [address, 0], rpcProfile);
      totalReceived += Number(received) || 0;
    } catch {
      /* ignore */
    }
  }

  if (totalReceived <= 0) {
    return 0;
  }

  let allTransactions = [];
  try {
    allTransactions = await tajcoinRpc("listtransactions", ["*", 1000], rpcProfile);
  } catch {
    return Math.max(0, totalReceived);
  }

  let totalSent = 0;
  for (const tx of allTransactions) {
    if (tx.category === "send" && tx.amount < 0 && tx.account === accountName) {
      totalSent += Math.abs(tx.amount);
    }
  }

  return Math.max(0, totalReceived - totalSent);
}

async function getAccountTransactions(accountName, count = 50, rpcProfile = LOCAL_PROFILE) {
  const accountAddresses = await getAccountAddresses(accountName, rpcProfile);
  if (!accountAddresses.length) {
    return [];
  }

  let allTransactions = [];
  try {
    allTransactions = await tajcoinRpc("listtransactions", ["*", count], rpcProfile);
  } catch {
    return [];
  }

  return allTransactions.filter((tx) => {
    if (tx.category === "send") {
      return tx.account === accountName;
    }
    if (tx.category === "receive") {
      return accountAddresses.includes(tx.address || "");
    }
    const address = tx.address || "";
    return accountAddresses.includes(address) || tx.account === accountName;
  });
}

async function generateNewAddress(accountName, rpcProfile = LOCAL_PROFILE) {
  return tajcoinRpc("getnewaddress", [accountName], rpcProfile);
}

async function sendFromAccount(accountName, toAddress, amount, comment = "", rpcProfile = LOCAL_PROFILE) {
  const params = [accountName, toAddress, amount, 0];
  if (comment) {
    params.push(comment);
  }
  return tajcoinRpc("sendfrom", params, rpcProfile);
}

async function sendFromAddress(
  accountName,
  fromAddress,
  toAddress,
  amount,
  comment = "",
  rpcProfile = LOCAL_PROFILE
) {
  const addresses = await getAccountAddresses(accountName, rpcProfile);
  if (!addresses.includes(fromAddress)) {
    throw new Error(`L'adresse ${fromAddress} n'appartient pas à ce compte`);
  }
  return sendFromAccount(accountName, toAddress, amount, comment, rpcProfile);
}

async function validateAddress(address, rpcProfile = LOCAL_PROFILE) {
  return tajcoinRpc("validateaddress", [address], rpcProfile);
}

async function getNodeInfo(rpcProfile = LOCAL_PROFILE) {
  try {
    return await tajcoinRpc("getblockchaininfo", [], rpcProfile);
  } catch {
    return tajcoinRpc("getinfo", [], rpcProfile);
  }
}

async function getLocalNodeWallet(rpcProfile = LOCAL_PROFILE) {
  const accountName = DEFAULT_ACCOUNT;
  let addresses = await getAccountAddresses(accountName, rpcProfile);

  if (!addresses.length) {
    const tajcoinAddress = await tajcoinRpc("getnewaddress", [accountName], rpcProfile);
    addresses = [tajcoinAddress];
  }

  const [balance, transactions, nodeInfo] = await Promise.all([
    getAccountBalance(accountName, addresses, rpcProfile),
    getAccountTransactions(accountName, 50, rpcProfile),
    getNodeInfo(rpcProfile),
  ]);

  return {
    mode: "local",
    accountName,
    tajcoinAddress: addresses[0],
    allAddresses: addresses,
    balance,
    transactions,
    nodeInfo,
  };
}

module.exports = {
  DEFAULT_ACCOUNT,
  generateAccountName,
  checkTajCoinAccount,
  createTajCoinAccount,
  getOrCreateTajCoinAccount,
  getAccountBalance,
  getAccountAddresses,
  getAccountTransactions,
  generateNewAddress,
  sendFromAccount,
  sendFromAddress,
  validateAddress,
  getNodeInfo,
  getLocalNodeWallet,
};
