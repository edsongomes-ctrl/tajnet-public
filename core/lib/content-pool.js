"use strict";

const fs = require("fs");
const path = require("path");
const { LOCAL_PROFILE, tajcoinRpc } = require("./tajcoin");
const { getAccountAddresses, sendFromAccount, sendFromAddress } = require("./wallet-accounts");
const {
  REWARD_ESCROW_ACCOUNT,
  PIN_REWARD_AUTO_PAY,
  findAccountForAddress,
  ensureWalletUnlocked,
} = require("./pin-rewards");
const { buildRewardSplitPlan, resolveHostAddress, SPLIT } = require("./reward-split");

const PIN_ACCOUNT = process.env.PIN_ACCOUNT || "tajpin";
const PIN_REWARD_PER_CLAIM = Number(
  process.env.PIN_REWARD_PER_CLAIM || process.env.DISCOVER_PIN_PRICE_TAJ || 0.5
);

function normalizeAddress(address) {
  return String(address || "").trim();
}

function claimKey(address) {
  return normalizeAddress(address).toLowerCase();
}

function defaultStore() {
  return { version: 2, pools: {} };
}

function defaultPool(contentCid) {
  return {
    contentCid,
    rewardPerClaim: PIN_REWARD_PER_CLAIM,
    totalContributed: 0,
    totalClaimed: 0,
    investorReserve: 0,
    contributions: [],
    claims: {},
  };
}

function buildRewardComment(contentCid, claimAddress) {
  return JSON.stringify({ type: "pin-reward-pool", contentCid, claimAddress });
}

async function getAccountSpendable(accountName, rpcProfile = LOCAL_PROFILE) {
  try {
    return Number(await tajcoinRpc("getbalance", [accountName, 1], rpcProfile)) || 0;
  } catch {
    const addresses = await getAccountAddresses(accountName, rpcProfile);
    let balance = 0;
    for (const address of addresses) {
      try {
        balance += Number(await tajcoinRpc("getreceivedbyaddress", [address, 1], rpcProfile)) || 0;
      } catch {
        /* ignore */
      }
    }
    return balance;
  }
}

async function getAddressBalance(address, minConf = 1, rpcProfile = LOCAL_PROFILE) {
  try {
    return Number(await tajcoinRpc("getreceivedbyaddress", [address, minConf], rpcProfile)) || 0;
  } catch {
    return 0;
  }
}

class ContentPoolLedger {
  constructor({ dataDir } = {}) {
    this.storePath = path.join(dataDir, "content-pools.json");
    this.store = defaultStore();
  }

  load() {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    try {
      if (fs.existsSync(this.storePath)) {
        this.store = { ...defaultStore(), ...JSON.parse(fs.readFileSync(this.storePath, "utf8")) };
      }
    } catch {
      this.store = defaultStore();
    }
  }

  persist() {
    fs.writeFileSync(this.storePath, `${JSON.stringify(this.store, null, 2)}\n`, "utf8");
  }

  ensurePool(contentCid) {
    if (!this.store.pools[contentCid]) {
      this.store.pools[contentCid] = defaultPool(contentCid);
    }
    const pool = this.store.pools[contentCid];
    pool.rewardPerClaim = PIN_REWARD_PER_CLAIM;
    return pool;
  }

  getPool(contentCid) {
    if (!contentCid) return null;
    const pool = this.store.pools[contentCid];
    if (!pool) {
      return {
        contentCid,
        rewardPerClaim: PIN_REWARD_PER_CLAIM,
        readerSharePerClaim: Number((PIN_REWARD_PER_CLAIM * (SPLIT.reader || 0.25)).toFixed(8)),
        split: { ...SPLIT },
        totalContributed: 0,
        totalClaimed: 0,
        availableTaj: 0,
        investorReserve: 0,
        claimCount: 0,
        remainingClaims: 0,
        contributions: [],
        claims: [],
      };
    }
    return this.publicPool(pool);
  }

  publicPool(pool) {
    const availableTaj = Math.max(0, Number(pool.totalContributed || 0) - Number(pool.totalClaimed || 0));
    const rewardPerClaim = Number(pool.rewardPerClaim || PIN_REWARD_PER_CLAIM);
    const claims = Object.values(pool.claims || {});
    const readerShare = Number((rewardPerClaim * (SPLIT.reader || 0.25)).toFixed(8));
    return {
      contentCid: pool.contentCid,
      rewardPerClaim,
      readerSharePerClaim: readerShare,
      split: { ...SPLIT },
      totalContributed: Number(pool.totalContributed || 0),
      totalClaimed: Number(pool.totalClaimed || 0),
      availableTaj,
      investorReserve: Number(pool.investorReserve || 0),
      claimCount: claims.length,
      remainingClaims: rewardPerClaim > 0 ? Math.floor(availableTaj / rewardPerClaim) : 0,
      contributions: pool.contributions || [],
      claims,
    };
  }

  hasClaimed(contentCid, claimAddress) {
    const pool = this.store.pools[contentCid];
    if (!pool) return false;
    return Boolean(pool.claims?.[claimKey(claimAddress)]);
  }

  addContribution(contentCid, { amount, source = "unknown", txid = null, payerAddress = null, sourceTxid = null } = {}) {
    const value = Math.max(0, Number(amount) || 0);
    if (!contentCid || value <= 0) {
      return this.getPool(contentCid);
    }
    const pool = this.ensurePool(contentCid);
    if (txid && pool.contributions.some((c) => c.txid === txid)) {
      return this.publicPool(pool);
    }
    pool.totalContributed = Number((pool.totalContributed + value).toFixed(8));
    pool.contributions.push({
      amount: value,
      source,
      txid,
      payerAddress,
      sourceTxid,
      at: new Date().toISOString(),
    });
    this.persist();
    return this.publicPool(pool);
  }

  async paySplitPayouts(
    { payouts, contentCid, claimAddress, rewardEscrowAddress = null },
    rpcProfile = LOCAL_PROFILE
  ) {
    const total = payouts.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    if (total <= 0) {
      return { ok: false, reason: "Aucun paiement à effectuer" };
    }

    await ensureWalletUnlocked(rpcProfile);

    let fundSource = null;
    if (rewardEscrowAddress) {
      const account = await findAccountForAddress(rewardEscrowAddress, rpcProfile);
      const escrowBalance = account ? await getAddressBalance(rewardEscrowAddress, 1, rpcProfile) : 0;
      if (account && escrowBalance + 1e-8 >= total) {
        fundSource = { type: "escrow", account, address: rewardEscrowAddress };
      }
    }

    if (!fundSource) {
      const spendable = await getAccountSpendable(PIN_ACCOUNT, rpcProfile);
      if (spendable + 1e-8 < total) {
        return {
          ok: false,
          reason: `Solde ${PIN_ACCOUNT} insuffisant (${spendable.toFixed(4)} < ${total.toFixed(4)} TAJ)`,
        };
      }
      fundSource = { type: "account", name: PIN_ACCOUNT };
    }

    const paid = [];
    for (const payout of payouts) {
      const comment = JSON.stringify({
        type: "reward-split",
        role: payout.role,
        contentCid,
        claimAddress,
      });
      let paymentTxid;
      if (fundSource.type === "escrow") {
        paymentTxid = await sendFromAddress(
          fundSource.account,
          fundSource.address,
          payout.address,
          payout.amount,
          comment,
          rpcProfile
        );
      } else {
        paymentTxid = await sendFromAccount(
          fundSource.name,
          payout.address,
          payout.amount,
          comment,
          rpcProfile
        );
      }
      paid.push({ ...payout, paymentTxid });
    }

    return {
      ok: true,
      payouts: paid,
      source: fundSource.type === "escrow" ? "escrow" : PIN_ACCOUNT,
      paymentTxid: paid[0]?.paymentTxid || null,
      total,
    };
  }

  async payClaim({ contentCid, claimAddress, rewardEscrowAddress = null }, rpcProfile = LOCAL_PROFILE) {
    const amount = PIN_REWARD_PER_CLAIM;
    let payment = null;

    if (rewardEscrowAddress) {
      const account = await findAccountForAddress(rewardEscrowAddress, rpcProfile);
      const escrowBalance = account ? await getAddressBalance(rewardEscrowAddress, 1, rpcProfile) : 0;
      if (account && escrowBalance + 1e-8 >= amount) {
        await ensureWalletUnlocked(rpcProfile);
        const paymentTxid = await sendFromAddress(
          account,
          rewardEscrowAddress,
          claimAddress,
          amount,
          buildRewardComment(contentCid, claimAddress),
          rpcProfile
        );
        payment = { ok: true, paymentTxid, source: "escrow", fromAccount: account };
      }
    }

    if (!payment?.ok) {
      const spendable = await getAccountSpendable(PIN_ACCOUNT, rpcProfile);
      if (spendable + 1e-8 < amount) {
        return {
          ok: false,
          reason: `Solde ${PIN_ACCOUNT} insuffisant (${spendable.toFixed(4)} < ${amount} TAJ)`,
        };
      }
      await ensureWalletUnlocked(rpcProfile);
      const paymentTxid = await sendFromAccount(
        PIN_ACCOUNT,
        claimAddress,
        amount,
        buildRewardComment(contentCid, claimAddress),
        rpcProfile
      );
      payment = { ok: true, paymentTxid, source: PIN_ACCOUNT, fromAccount: PIN_ACCOUNT };
    }

    return payment;
  }

  async claimFromPool(
    contentCid,
    claimAddress,
    { rewardEscrowAddress = null, entry = null, stakingLedger = null } = {},
    rpcProfile = LOCAL_PROFILE
  ) {
    if (!PIN_REWARD_AUTO_PAY) {
      return { status: "skipped", reason: "Paiement auto désactivé (PIN_REWARD_AUTO_PAY=false)" };
    }

    const address = normalizeAddress(claimAddress);
    if (!contentCid || !address) {
      return { status: "failed", error: "contentCid et claimAddress requis" };
    }

    const pool = this.ensurePool(contentCid);
    const available = pool.totalContributed - pool.totalClaimed;
    const rewardPerClaim = Number(pool.rewardPerClaim || PIN_REWARD_PER_CLAIM);

    if (this.hasClaimed(contentCid, address)) {
      return {
        status: "already_claimed",
        error: "Cette adresse a déjà réclamé sa part pour ce contenu",
        claim: pool.claims[claimKey(address)],
      };
    }

    if (available + 1e-8 < rewardPerClaim) {
      return {
        status: "insufficient_pool",
        error: `Cagnotte insuffisante (${available.toFixed(4)} TAJ disponibles, ${rewardPerClaim} TAJ requis)`,
        pool: this.publicPool(pool),
      };
    }

    const publisherAddress =
      entry?.publisherAddress ||
      entry?.metadata?.publisherAddress ||
      entry?.metadata?.author ||
      null;
    const hostAddress = await resolveHostAddress(rpcProfile);
    const activeStakes = stakingLedger?.listByContent(contentCid) || [];
    const splitPlan = buildRewardSplitPlan({
      total: rewardPerClaim,
      claimAddress: address,
      publisherAddress,
      hostAddress,
      activeStakes,
    });

    const payment = await this.paySplitPayouts(
      {
        payouts: splitPlan.payouts,
        contentCid,
        claimAddress: address,
        rewardEscrowAddress,
      },
      rpcProfile
    );

    if (!payment?.ok) {
      return {
        status: "awaiting_payment",
        error: payment?.reason || "Paiement impossible sur ce nœud",
        claimAddress: address,
        amount: rewardPerClaim,
        splitPlan,
        pool: this.publicPool(pool),
      };
    }

    pool.totalClaimed = Number((pool.totalClaimed + rewardPerClaim).toFixed(8));
    if (splitPlan.investorReserve > 0) {
      pool.investorReserve = Number((Number(pool.investorReserve || 0) + splitPlan.investorReserve).toFixed(8));
    }
    pool.claims[claimKey(address)] = {
      claimAddress: address,
      amount: rewardPerClaim,
      readerAmount: splitPlan.amounts.reader,
      paymentTxid: payment.paymentTxid,
      paymentSource: payment.source,
      splits: payment.payouts,
      investorReserveAdded: splitPlan.investorReserve,
      claimedAt: new Date().toISOString(),
    };
    this.persist();

    return {
      status: "paid",
      paymentTxid: payment.paymentTxid,
      amount: rewardPerClaim,
      source: payment.source,
      claimAddress: address,
      splits: payment.payouts,
      splitPlan,
      pool: this.publicPool(pool),
    };
  }

  status() {
    const pools = Object.values(this.store.pools || {});
    const totalContributed = pools.reduce((sum, p) => sum + Number(p.totalContributed || 0), 0);
    const totalClaimed = pools.reduce((sum, p) => sum + Number(p.totalClaimed || 0), 0);
    const claimCount = pools.reduce((sum, p) => sum + Object.keys(p.claims || {}).length, 0);
    return {
      rewardPerClaim: PIN_REWARD_PER_CLAIM,
      readerSharePerClaim: Number((PIN_REWARD_PER_CLAIM * (SPLIT.reader || 0.25)).toFixed(8)),
      split: { ...SPLIT },
      poolCount: pools.length,
      totalContributed,
      totalClaimed,
      availableTaj: Math.max(0, totalContributed - totalClaimed),
      claimCount,
    };
  }

  syncLegacy({ ledger = null, pins = null } = {}) {
    let changed = false;

    if (ledger?.registry?.rewards) {
      for (const row of Object.values(ledger.registry.rewards)) {
        if (!row?.contentCid || !row.amount) continue;
        const before = this.getPool(row.contentCid).totalContributed;
        this.addContribution(row.contentCid, {
          amount: row.amount,
          source: "publisher-escrow",
          txid: row.fundTxid || null,
          sourceTxid: row.announceTxid || null,
        });
        if (this.getPool(row.contentCid).totalContributed !== before) {
          changed = true;
        }
        if (row.status === "paid" && row.claimAddress && !this.hasClaimed(row.contentCid, row.claimAddress)) {
          const pool = this.ensurePool(row.contentCid);
          const rewardPerClaim = Number(pool.rewardPerClaim || PIN_REWARD_PER_CLAIM);
          pool.totalClaimed = Number((pool.totalClaimed + rewardPerClaim).toFixed(8));
          pool.claims[claimKey(row.claimAddress)] = {
            claimAddress: row.claimAddress,
            amount: rewardPerClaim,
            paymentTxid: row.paymentTxid || null,
            paymentSource: row.source || "legacy",
            claimedAt: row.paidAt || new Date().toISOString(),
            legacy: true,
          };
          changed = true;
        }
      }
    }

    if (pins?.pins) {
      for (const pin of Object.values(pins.pins)) {
        if (!pin?.contentCid || !pin.paid || !pin.amount) continue;
        const before = this.getPool(pin.contentCid).totalContributed;
        this.addContribution(pin.contentCid, {
          amount: pin.amount,
          source: "pin-service",
          txid: pin.paymentTxid || null,
          payerAddress: pin.paymentAddress || null,
          sourceTxid: pin.sourceTxid || null,
        });
        if (this.getPool(pin.contentCid).totalContributed !== before) {
          changed = true;
        }
        if (pin.claim?.status === "paid" && pin.claim.claimAddress && !this.hasClaimed(pin.contentCid, pin.claim.claimAddress)) {
          const pool = this.ensurePool(pin.contentCid);
          const rewardPerClaim = Number(pool.rewardPerClaim || PIN_REWARD_PER_CLAIM);
          pool.totalClaimed = Number((pool.totalClaimed + rewardPerClaim).toFixed(8));
          pool.claims[claimKey(pin.claim.claimAddress)] = {
            claimAddress: pin.claim.claimAddress,
            amount: rewardPerClaim,
            paymentTxid: pin.claim.paymentTxid || null,
            paymentSource: pin.claim.paymentSource || "legacy",
            claimedAt: pin.claim.paidAt || pin.pinnedAt || new Date().toISOString(),
            legacy: true,
          };
          changed = true;
        }
      }
    }

    if (changed) {
      this.persist();
    }
    return changed;
  }
}

module.exports = {
  ContentPoolLedger,
  PIN_REWARD_PER_CLAIM,
  normalizeAddress,
};
