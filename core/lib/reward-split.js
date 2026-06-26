"use strict";

const { getAccountAddresses } = require("./wallet-accounts");

const HOST_REWARD_ACCOUNT = process.env.HOST_REWARD_ACCOUNT || process.env.TAJNET_WALLET_ACCOUNT || "tajpanel";

const SPLIT = {
  creator: Number(
    process.env.REWARD_SPLIT_CREATOR ?? process.env.REWARD_SPLIT_CONTRIBUTOR ?? 0.25
  ),
  reader: Number(process.env.REWARD_SPLIT_READER ?? 0.25),
  host: Number(process.env.REWARD_SPLIT_HOST ?? 0.25),
  investor: Number(process.env.REWARD_SPLIT_INVESTOR ?? 0.25),
};

function normalizeAddress(address) {
  return String(address || "").trim();
}

function splitAmounts(total) {
  const t = Math.max(0, Number(total) || 0);
  const creator = Number((t * SPLIT.creator).toFixed(8));
  const reader = Number((t * SPLIT.reader).toFixed(8));
  const host = Number((t * SPLIT.host).toFixed(8));
  const investor = Number((t - creator - reader - host).toFixed(8));
  return { creator, reader, host, investor, total: t };
}

async function resolveHostAddress(rpcProfile) {
  const addresses = await getAccountAddresses(HOST_REWARD_ACCOUNT, rpcProfile);
  return addresses[0] || null;
}

function buildRewardSplitPlan({
  total,
  claimAddress,
  publisherAddress = null,
  hostAddress = null,
  activeStakes = [],
} = {}) {
  const amounts = splitAmounts(total);
  const payouts = [];
  let investorReserve = 0;

  const readerAddr = normalizeAddress(claimAddress);
  if (readerAddr && amounts.reader > 0) {
    payouts.push({ role: "reader", address: readerAddr, amount: amounts.reader });
  }

  const creatorAddr = normalizeAddress(publisherAddress);
  if (creatorAddr && amounts.creator > 0) {
    payouts.push({ role: "creator", address: creatorAddr, amount: amounts.creator });
  } else if (amounts.creator > 0) {
    investorReserve += amounts.creator;
  }

  const hostAddr = normalizeAddress(hostAddress);
  if (hostAddr && amounts.host > 0) {
    payouts.push({ role: "host", address: hostAddr, amount: amounts.host });
  } else if (amounts.host > 0) {
    investorReserve += amounts.host;
  }

  const stakes = (activeStakes || []).filter((s) => s.status === "active" && normalizeAddress(s.stakerAddress));
  if (amounts.investor > 0) {
    if (stakes.length) {
      const totalStaked = stakes.reduce((sum, s) => sum + Math.max(0, Number(s.amount) || 0), 0);
      if (totalStaked > 0) {
        let assigned = 0;
        stakes.forEach((stake, index) => {
          const isLast = index === stakes.length - 1;
          const weight = Number(stake.amount) / totalStaked;
          const share = isLast
            ? Number((amounts.investor - assigned).toFixed(8))
            : Number((amounts.investor * weight).toFixed(8));
          assigned += share;
          if (share > 0) {
            payouts.push({
              role: "investor",
              address: normalizeAddress(stake.stakerAddress),
              amount: share,
              stakeId: stake.stakeId,
            });
          }
        });
      } else {
        investorReserve += amounts.investor;
      }
    } else {
      investorReserve += amounts.investor;
    }
  }

  investorReserve = Number(investorReserve.toFixed(8));

  return {
    amounts,
    payouts,
    investorReserve,
    split: { ...SPLIT },
  };
}

module.exports = {
  SPLIT,
  HOST_REWARD_ACCOUNT,
  splitAmounts,
  resolveHostAddress,
  buildRewardSplitPlan,
  normalizeAddress,
};
