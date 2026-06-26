"use strict";

const { resolveProfile } = require("../routes/super-cv");

function cvProfileIdFromEntry(entry, cvIndex) {
  if (!entry) return null;
  const profile = cvIndex ? resolveProfile(cvIndex, entry.txid) : null;
  return profile?.id || entry.txid?.slice(0, 16) || entry.txid || null;
}

function gateCvDiscoverEntry(entry, { cvIndex, cvAccess, claimAddress } = {}) {
  if (!entry || entry.type !== "cv") {
    return entry;
  }

  const profileId = cvProfileIdFromEntry(entry, cvIndex);
  const hasIpfsContent = Boolean(entry.contentCid);
  const accessEnabled = cvAccess?.isEnabled?.() !== false;
  const unlocked =
    hasIpfsContent && accessEnabled && cvAccess?.hasAccess(profileId, claimAddress);

  const cvMeta = {
    cvProfileId: profileId,
    cvHasIpfsContent: hasIpfsContent,
    cvContentUnlocked: unlocked,
    cvFicheUrl: profileId ? `/cv?id=${encodeURIComponent(profileId)}` : null,
    cvAccessPrice: cvAccess?.getPrice?.() ?? 1,
    cvAccessEnabled: accessEnabled,
  };

  if (!hasIpfsContent || unlocked) {
    return { ...entry, ...cvMeta };
  }

  if (!accessEnabled) {
    return {
      ...entry,
      ...cvMeta,
      contentUrl: null,
      publicContentUrl: null,
      contentCid: null,
    };
  }

  return {
    ...entry,
    ...cvMeta,
    contentUrl: null,
    publicContentUrl: null,
    contentCid: null,
  };
}

function gateCvViewFields(fields, { cvIndex, cvAccess, recruiterAddress } = {}) {
  if (!fields || fields.type !== "cv") {
    return fields;
  }

  const profileId = cvProfileIdFromEntry({ txid: fields.txid, contentCid: fields.contentCid }, cvIndex);
  const hasIpfsContent = Boolean(fields.contentCid);
  const accessEnabled = cvAccess?.isEnabled?.() !== false;
  const unlocked =
    hasIpfsContent && accessEnabled && cvAccess?.hasAccess(profileId, recruiterAddress);

  const cvMeta = {
    cvProfileId: profileId,
    cvHasIpfsContent: hasIpfsContent,
    cvContentUnlocked: unlocked,
    cvFicheUrl: profileId ? `/cv?id=${encodeURIComponent(profileId)}` : null,
    cvAccessPrice: cvAccess?.getPrice?.() ?? 1,
    cvAccessEnabled: accessEnabled,
  };

  if (!hasIpfsContent || unlocked) {
    return { ...fields, ...cvMeta };
  }

  return {
    ...fields,
    ...cvMeta,
    contentUrl: null,
    publicContentUrl: null,
    contentCid: null,
  };
}

module.exports = {
  cvProfileIdFromEntry,
  gateCvDiscoverEntry,
  gateCvViewFields,
};
