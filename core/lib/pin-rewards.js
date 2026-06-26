"use strict";

const fs = require("fs");
const path = require("path");
const { LOCAL_PROFILE, tajcoinRpc } = require("./tajcoin");
const { getAccountAddresses, sendFromAccount, sendFromAddress } = require("./wallet-accounts");

const REWARD_ESCROW_ACCOUNT = process.env.REWARD_ESCROW_ACCOUNT || "tajescrow";
const ANNOUNCE_ACCOUNT = process.env.ANNOUNCE_ACCOUNT || "tajannounce";
const ANNOUNCE_WALLET_PASSPHRASE =
  process.env.ANNOUNCE_WALLET_PASSPHRASE || process.env.TAJCOIN_WALLET_PASSPHRASE || "";
const PIN_REWARD_AUTO_PAY = process.env.PIN_REWARD_AUTO_PAY !== "false";

function buildRewardComment(contentCid, claimAddress) {
  return JSON.stringify({
    type: "pin-reward",
    contentCid,
    claimAddress,
  });
}

async function ensureWalletUnlocked(rpcProfile = LOCAL_PROFILE) {
  if (!ANNOUNCE_WALLET_PASSPHRASE) {
    return;
  }
  try {
    await tajcoinRpc("walletpassphrase", [ANNOUNCE_WALLET_PASSPHRASE, 60], rpcProfile);
  } catch (err) {
    if (!/unencrypted/i.test(err.message)) {
      throw err;
    }
  }
}

async function findAccountForAddress(address, rpcProfile = LOCAL_PROFILE) {
  if (!address) {
    return null;
  }

  try {
    const info = await tajcoinRpc("validateaddress", [address], rpcProfile);
    if (info?.account) {
      return info.account;
    }
  } catch {
    /* ignore */
  }

  const candidates = [REWARD_ESCROW_ACCOUNT, ANNOUNCE_ACCOUNT, "tajpin", "tajpanel"];
  for (const account of candidates) {
    const addresses = await getAccountAddresses(account, rpcProfile);
    if (addresses.includes(address)) {
      return account;
    }
  }

  return null;
}

async function getAddressBalance(address, minConf = 0, rpcProfile = LOCAL_PROFILE) {
  try {
    return Number(await tajcoinRpc("getreceivedbyaddress", [address, minConf], rpcProfile)) || 0;
  } catch {
    return 0;
  }
}

function defaultRegistry() {
  return { version: 1, rewards: {} };
}

class PinRewardLedger {
  constructor({ dataDir } = {}) {
    this.registryPath = path.join(dataDir, "reward-registry.json");
    this.registry = defaultRegistry();
  }

  load() {
    fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
    try {
      if (fs.existsSync(this.registryPath)) {
        this.registry = { ...defaultRegistry(), ...JSON.parse(fs.readFileSync(this.registryPath, "utf8")) };
      }
    } catch {
      this.registry = defaultRegistry();
    }
  }

  persist() {
    fs.writeFileSync(this.registryPath, `${JSON.stringify(this.registry, null, 2)}\n`, "utf8");
  }

  get(contentCid) {
    return this.registry.rewards?.[contentCid] || null;
  }

  upsert(contentCid, patch) {
    this.registry.rewards[contentCid] = {
      ...(this.registry.rewards[contentCid] || {}),
      contentCid,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    return this.registry.rewards[contentCid];
  }

  isPaid(contentCid) {
    const row = this.get(contentCid);
    return row?.status === "paid";
  }

  status() {
    const rewards = Object.values(this.registry.rewards || {});
    return {
      autoPay: PIN_REWARD_AUTO_PAY,
      escrowAccount: REWARD_ESCROW_ACCOUNT,
      total: rewards.length,
      funded: rewards.filter((r) => r.status === "funded").length,
      paid: rewards.filter((r) => r.status === "paid").length,
      awaitingFunds: rewards.filter((r) => r.status === "awaiting_funds").length,
    };
  }
}

async function createRewardEscrowAddress(rpcProfile = LOCAL_PROFILE) {
  await ensureWalletUnlocked(rpcProfile);
  const addresses = await getAccountAddresses(REWARD_ESCROW_ACCOUNT, rpcProfile);
  if (!addresses.length) {
    await tajcoinRpc("getnewaddress", [REWARD_ESCROW_ACCOUNT], rpcProfile);
  }
  return tajcoinRpc("getnewaddress", [REWARD_ESCROW_ACCOUNT], rpcProfile);
}

async function fundRewardEscrow(
  { contentCid, rewardEscrowAddress, amount, announceTxid, metadataCid },
  ledger,
  rpcProfile = LOCAL_PROFILE,
  contentPool = null
) {
  if (!PIN_REWARD_AUTO_PAY || !amount || amount <= 0 || !rewardEscrowAddress) {
    return { status: "skipped", reason: "Récompense nulle ou auto-pay désactivé" };
  }

  const existing = ledger?.get(contentCid);
  if (existing?.status === "funded" && existing.fundTxid) {
    contentPool?.addContribution(contentCid, {
      amount,
      source: "publisher-escrow",
      txid: existing.fundTxid,
      sourceTxid: announceTxid || existing.announceTxid,
    });
    return {
      status: "funded",
      fundTxid: existing.fundTxid,
      rewardEscrowAddress: existing.rewardEscrowAddress || rewardEscrowAddress,
      amount,
      alreadyFunded: true,
    };
  }

  const announceBalance = await getAccountSpendable(ANNOUNCE_ACCOUNT, rpcProfile);
  if (announceBalance + 1e-8 < amount) {
    ledger?.upsert(contentCid, {
      rewardEscrowAddress,
      amount,
      announceTxid,
      metadataCid,
      status: "awaiting_funds",
      error: `Solde ${ANNOUNCE_ACCOUNT} insuffisant (${announceBalance} < ${amount} TAJ)`,
    });
    return {
      status: "awaiting_funds",
      error: `Alimentez le compte ${ANNOUNCE_ACCOUNT} pour verrouiller ${amount} TAJ`,
    };
  }

  await ensureWalletUnlocked(rpcProfile);
  const comment = JSON.stringify({ type: "pin-reward-escrow", contentCid, announceTxid });
  const fundTxid = await sendFromAccount(
    ANNOUNCE_ACCOUNT,
    rewardEscrowAddress,
    amount,
    comment,
    rpcProfile
  );

  ledger?.upsert(contentCid, {
    rewardEscrowAddress,
    amount,
    announceTxid,
    metadataCid,
    fundTxid,
    status: "funded",
  });

  contentPool?.addContribution(contentCid, {
    amount,
    source: "publisher-escrow",
    txid: fundTxid,
    sourceTxid: announceTxid,
  });

  return { status: "funded", fundTxid, rewardEscrowAddress, amount };
}

async function getAccountSpendable(accountName, rpcProfile = LOCAL_PROFILE) {
  const addresses = await getAccountAddresses(accountName, rpcProfile);
  if (!addresses.length) {
    return 0;
  }

  let balance = 0;
  try {
    balance = Number(await tajcoinRpc("getbalance", [accountName, 1], rpcProfile)) || 0;
  } catch {
    for (const address of addresses) {
      balance += await getAddressBalance(address, 1, rpcProfile);
    }
  }
  return balance;
}

async function payFromEscrow({ rewardEscrowAddress, amount, claimAddress, contentCid }, rpcProfile) {
  const account = await findAccountForAddress(rewardEscrowAddress, rpcProfile);
  if (!account) {
    return { ok: false, reason: "Escrow hors wallet local" };
  }

  const escrowBalance = await getAddressBalance(rewardEscrowAddress, 1, rpcProfile);
  if (escrowBalance + 1e-8 < amount) {
    return { ok: false, reason: `Escrow sous-alimenté (${escrowBalance} < ${amount} TAJ)` };
  }

  await ensureWalletUnlocked(rpcProfile);
  const paymentTxid = await sendFromAddress(
    account,
    rewardEscrowAddress,
    claimAddress,
    amount,
    buildRewardComment(contentCid, claimAddress),
    rpcProfile
  );

  return { ok: true, paymentTxid, source: "escrow", fromAccount: account };
}

async function payFromPublisher({ publisherAddress, amount, claimAddress, contentCid }, rpcProfile) {
  const account = await findAccountForAddress(publisherAddress, rpcProfile);
  if (!account) {
    return { ok: false, reason: "Publisher hors wallet local" };
  }

  const spendable = await getAccountSpendable(account, rpcProfile);
  if (spendable + 1e-8 < amount) {
    return { ok: false, reason: `Solde publisher insuffisant (${spendable} < ${amount} TAJ)` };
  }

  await ensureWalletUnlocked(rpcProfile);
  const paymentTxid = await sendFromAccount(
    account,
    claimAddress,
    amount,
    buildRewardComment(contentCid, claimAddress),
    rpcProfile
  );

  return { ok: true, paymentTxid, source: "publisher", fromAccount: account };
}

async function settlePinReward(
  { entry, claim },
  ledger,
  contentPool = null,
  rpcProfile = LOCAL_PROFILE,
  stakingLedger = null
) {
  if (!PIN_REWARD_AUTO_PAY || !claim?.claimAddress) {
    return { status: "skipped", reason: "Auto-pay désactivé ou claim invalide" };
  }

  const contentCid = entry?.contentCid;
  if (!contentCid) {
    return { status: "skipped", reason: "CID contenu manquant" };
  }

  if (contentPool) {
    const rewardEscrowAddress =
      entry?.metadata?.rewardEscrowAddress ||
      entry?.rewardEscrowAddress ||
      ledger?.get(contentCid)?.rewardEscrowAddress;
    const settlement = await contentPool.claimFromPool(
      contentCid,
      claim.claimAddress,
      { rewardEscrowAddress, entry, stakingLedger },
      rpcProfile
    );

    if (settlement.status === "paid") {
      ledger?.upsert(contentCid, {
        rewardEscrowAddress,
        claimAddress: claim.claimAddress,
        paymentTxid: settlement.paymentTxid,
        status: "paid",
        paidAt: new Date().toISOString(),
        source: settlement.source,
      });
    }

    return settlement;
  }

  const amount = Number(claim.pinRewardTaj || entry?.pinRewardTaj || 0);
  if (amount <= 0) {
    return { status: "skipped", reason: "Pas de récompense configurée" };
  }

  if (ledger?.isPaid(contentCid)) {
    const row = ledger.get(contentCid);
    return {
      status: "paid",
      paymentTxid: row.paymentTxid,
      alreadyPaid: true,
    };
  }

  const rewardEscrowAddress =
    entry?.metadata?.rewardEscrowAddress || entry?.rewardEscrowAddress || ledger?.get(contentCid)?.rewardEscrowAddress;
  const publisherAddress = entry?.publisherAddress || entry?.metadata?.publisherAddress;

  let payment = null;

  if (rewardEscrowAddress) {
    payment = await payFromEscrow(
      { rewardEscrowAddress, amount, claimAddress: claim.claimAddress, contentCid },
      rpcProfile
    );
  }

  if (!payment?.ok && publisherAddress) {
    payment = await payFromPublisher(
      { publisherAddress, amount, claimAddress: claim.claimAddress, contentCid },
      rpcProfile
    );
  }

  if (!payment?.ok) {
    return {
      status: "awaiting_payment",
      error: payment?.reason || "Paiement automatique impossible sur ce nœud",
      claimAddress: claim.claimAddress,
      amount,
    };
  }

  ledger?.upsert(contentCid, {
    rewardEscrowAddress,
    amount,
    claimAddress: claim.claimAddress,
    paymentTxid: payment.paymentTxid,
    status: "paid",
    paidAt: new Date().toISOString(),
    source: payment.source,
  });

  return {
    status: "paid",
    paymentTxid: payment.paymentTxid,
    amount,
    source: payment.source,
    claimAddress: claim.claimAddress,
  };
}

async function requestRemoteSettlement(entry, claim) {
  const endpoint = entry?.metadata?.publisherEndpoint || entry?.publisherEndpoint;
  if (!endpoint || !claim?.claimAddress || !entry?.contentCid) {
    return null;
  }

  const base = String(endpoint).replace(/\/$/, "");
  const { PIN_REWARD_PER_CLAIM } = require("./content-pool");
  try {
    const res = await fetch(`${base}/api/pin-rewards/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contentCid: entry.contentCid,
        claimAddress: claim.claimAddress,
        sourceTxid: entry.txid || null,
        amount: claim.pinRewardTaj || PIN_REWARD_PER_CLAIM,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (!res.ok) {
      return { status: "remote_failed", error: data.error || res.statusText };
    }
    return data.settlement || data;
  } catch (err) {
    return { status: "remote_failed", error: err.message };
  }
}

module.exports = {
  PinRewardLedger,
  REWARD_ESCROW_ACCOUNT,
  PIN_REWARD_AUTO_PAY,
  createRewardEscrowAddress,
  fundRewardEscrow,
  settlePinReward,
  requestRemoteSettlement,
  findAccountForAddress,
  ensureWalletUnlocked,
};
