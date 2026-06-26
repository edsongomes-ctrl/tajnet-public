"use strict";

const { PIN_REWARD_PER_CLAIM } = require("./content-pool");

function checkOpportunistClaimEligibility(
  contentCid,
  claimAddress,
  { discover = null, metricsStore = null, contentPool = null } = {}
) {
  const rewardPerClaim = PIN_REWARD_PER_CLAIM;
  const pool = contentPool?.getPool(contentCid) || null;
  const pinnedOnNode = Boolean(discover?.getLocalPin(contentCid));
  const viewedContent = Boolean(
    claimAddress && metricsStore?.hasViewer(contentCid, claimAddress)
  );
  const alreadyClaimed = Boolean(
    claimAddress && contentPool?.hasClaimed(contentCid, claimAddress)
  );
  const poolAvailable = Number(pool?.availableTaj || 0);
  const canClaimFromPool = poolAvailable + 1e-8 >= rewardPerClaim;

  let reason = null;
  if (!pinnedOnNode) {
    reason = "Contenu non épinglé sur ce nœud — un contributeur doit d'abord financer le pinning (don)";
  } else if (!viewedContent) {
    reason = "Consultez le contenu épinglé (fiche ou lien IPFS) avant de réclamer";
  } else if (alreadyClaimed) {
    reason = "Cette adresse a déjà réclamé sa part pour ce contenu";
  } else if (!canClaimFromPool) {
    reason = `Cagnotte insuffisante (${poolAvailable.toFixed(4)} TAJ disponibles)`;
  }

  return {
    eligible: pinnedOnNode && viewedContent && !alreadyClaimed && canClaimFromPool,
    pinnedOnNode,
    viewedContent,
    alreadyClaimed,
    canClaimFromPool,
    rewardPerClaim,
    pool,
    reason,
  };
}

module.exports = { checkOpportunistClaimEligibility };
