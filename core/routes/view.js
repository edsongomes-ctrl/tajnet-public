"use strict";

const express = require("express");
const { fetchIpfsJson } = require("../lib/ipfs");
const { buildClientIpfsUrls, getRequestOrigin } = require("../lib/ipfs-gateway");
const { normalizeUnicodeText } = require("../lib/text-encoding");
const { isStubMetadata } = require("../lib/discover");
const { buildContentMetrics } = require("../lib/content-metrics");
const { STAKE_PERIODS, STAKE_MIN_TAJ } = require("../lib/content-staking");
const { gateCvViewFields } = require("../lib/cv-discover-gate");
const { resolveClaimAddress } = require("./pin-rewards");

function resolveViewerAddress(req) {
  if (!req) return null;
  return resolveClaimAddress(req);
}

function createViewRouter(
  discover,
  { metricsStore = null, stakingLedger = null, contentPool = null, cvIndex = null, cvAccess = null } = {}
) {
  const router = express.Router();
  const pool = contentPool || discover.contentPool;
  const metrics = metricsStore || discover.metricsStore;

  function enrichViewFields(contentCid, baseFields, req = null) {
    if (contentCid && metrics) {
      metrics.recordVisit(contentCid, { source: "view" });
      const viewerAddress = resolveViewerAddress(req);
      if (viewerAddress && discover.getLocalPin(contentCid)) {
        metrics.recordViewer(contentCid, viewerAddress, { source: "view" });
      }
    }
    const contentPoolData = contentCid ? pool?.getPool(contentCid) || null : null;
    const contentMetrics = contentCid
      ? buildContentMetrics(contentCid, { contentPool: pool, metricsStore: metrics })
      : null;
    const stakingSummary = contentCid
      ? stakingLedger?.summaryForContent(contentCid, { contentPool: pool, metricsStore: metrics })
      : null;
    const claimAddress = resolveViewerAddress(req);
    const claimEligibility =
      contentCid && claimAddress
        ? discover.getClaimEligibility?.(contentCid, claimAddress) || null
        : null;
    return {
      ...baseFields,
      contentPool: contentPoolData,
      contentMetrics,
      stakingSummary,
      stakePeriods: STAKE_PERIODS,
      minStakeTaj: STAKE_MIN_TAJ,
      claimEligibility,
    };
  }

  router.get("/resolve", async (req, res) => {
    const txid = String(req.query.txid || "").trim();
    const metaCid = String(req.query.meta || req.query.cid || "").trim();
    const origin = getRequestOrigin(req);

    try {
      if (txid) {
        let entry = discover.getEntry(txid);
        if (!entry) {
          return res.status(404).json({ success: false, error: "Annonce introuvable dans l'index Discover" });
        }
        if (
          !entry.contentCid ||
          entry.metadataStatus !== "resolved" ||
          isStubMetadata(entry.metadata)
        ) {
          entry = await discover.enrichEntry(entry);
          discover.index.entries[txid] = entry;
          discover.persistIndex();
        }
        const enriched = discover.applyMetadataEconomics({ ...entry });
        const meta = enriched.metadata || {};
        const contentCid = enriched.contentCid || meta.contentCid || meta.fileCid || null;
        const contentUrls = contentCid ? buildClientIpfsUrls(contentCid, origin) : {};
        const metadataUrls = enriched.metadataCid
          ? buildClientIpfsUrls(enriched.metadataCid, origin)
          : {};
        const localPin = discover.getLocalPin(contentCid);

        const viewFields = gateCvViewFields(
          enrichViewFields(contentCid, {
            title: enriched.title || meta.title,
            type: enriched.type || meta.type,
            protocol: enriched.protocol,
            txid: enriched.txid,
            blockHeight: enriched.blockHeight,
            blockTime: enriched.blockTime,
            source: enriched.source,
            metadataCid: enriched.metadataCid,
            contentCid,
            metadata: meta,
            pinRewardTaj: enriched.pinRewardTaj,
            publisherAddress: enriched.publisherAddress || meta.publisherAddress,
            publisherEndpoint: enriched.publisherEndpoint || meta.publisherEndpoint,
            contentUrl: contentUrls.gatewayUrl,
            publicContentUrl: contentUrls.publicGatewayUrl,
            metadataUrl: metadataUrls.gatewayUrl,
            publicMetadataUrl: metadataUrls.publicGatewayUrl,
            localPinned: Boolean(localPin),
            localPin,
          }, req),
          {
            cvIndex,
            cvAccess,
            recruiterAddress: resolveViewerAddress(req),
          }
        );

        return res.json({
          success: true,
          view: buildViewModel(viewFields),
        });
      }

      if (metaCid) {
        const metadata = await fetchIpfsJson(metaCid);
        const contentCid = metadata.contentCid || metadata.fileCid || metadata.cid || null;
        const contentUrls = contentCid ? buildClientIpfsUrls(contentCid, origin) : {};
        const metadataUrls = buildClientIpfsUrls(metaCid, origin);

        return res.json({
          success: true,
          view: buildViewModel(
            enrichViewFields(contentCid, {
              title: metadata.title,
              type: metadata.type,
              protocol: metadata.protocol || "tajnet",
              txid: null,
              blockHeight: null,
              blockTime: metadata.timestamp ? Math.floor(Date.parse(metadata.timestamp) / 1000) : null,
              source: "ipfs",
              metadataCid: metaCid,
              contentCid,
              metadata,
              pinRewardTaj: metadata.pinRewardTaj,
              publisherAddress: metadata.publisherAddress || metadata.author,
              publisherEndpoint: metadata.publisherEndpoint,
              contentUrl: contentUrls.gatewayUrl,
              publicContentUrl: contentUrls.publicGatewayUrl,
              metadataUrl: metadataUrls.gatewayUrl,
              publicMetadataUrl: metadataUrls.publicGatewayUrl,
              localPinned: Boolean(discover.getLocalPin(contentCid)),
              localPin: discover.getLocalPin(contentCid),
            }, req)
          ),
        });
      }

      return res.status(400).json({
        success: false,
        error: "Paramètre txid ou meta (CID métadonnées) requis",
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

function buildViewModel(fields) {
  const metadata = fields.metadata || {};
  const title = normalizeUnicodeText(fields.title || metadata.title || "Publication TajNet");
  const type = fields.type || metadata.type || "file";
  const contentCid = fields.contentCid || null;
  const fileName = metadata.fileCid ? null : guessFileName(title, contentCid);
  const isHtml =
    type === "page" ||
    /\.html?$/i.test(title || "") ||
    /\.html?$/i.test(String(metadata.title || "")) ||
    /\.html?$/i.test(String(metadata.fileCid || ""));

  return {
    title,
    type,
    protocol: fields.protocol || metadata.protocol || "tajnet",
    txid: fields.txid || null,
    blockHeight: fields.blockHeight ?? null,
    blockTime: fields.blockTime ?? null,
    source: fields.source || null,
    metadataCid: fields.metadataCid || null,
    contentCid,
    pinRewardTaj: fields.pinRewardTaj ?? metadata.pinRewardTaj ?? null,
    publisherAddress: fields.publisherAddress || metadata.publisherAddress || metadata.author || null,
    publisherEndpoint: fields.publisherEndpoint || metadata.publisherEndpoint || null,
    sizeBytes: metadata.size ? Number(metadata.size) : null,
    timestamp: metadata.timestamp || null,
    contentUrl: fields.contentUrl || null,
    publicContentUrl: fields.publicContentUrl || null,
    metadataUrl: fields.metadataUrl || null,
    publicMetadataUrl: fields.publicMetadataUrl || null,
    contentPool: fields.contentPool || null,
    contentMetrics: fields.contentMetrics || null,
    stakingSummary: fields.stakingSummary || null,
    stakePeriods: fields.stakePeriods || null,
    minStakeTaj: fields.minStakeTaj ?? null,
    claimEligibility: fields.claimEligibility || null,
    localPinned: Boolean(fields.localPinned),
    localPin: fields.localPin || null,
    isHtml,
    fileName,
    metadata,
    cvProfileId: fields.cvProfileId || null,
    cvHasIpfsContent: fields.cvHasIpfsContent ?? null,
    cvContentUnlocked: fields.cvContentUnlocked ?? null,
    cvFicheUrl: fields.cvFicheUrl || null,
    cvAccessPrice: fields.cvAccessPrice ?? null,
    cvAccessEnabled: fields.cvAccessEnabled ?? null,
  };
}

function guessFileName(title, contentCid) {
  if (title && /\.\w{2,5}$/.test(title)) {
    return title;
  }
  return contentCid ? `${contentCid.slice(0, 12)}…` : null;
}

module.exports = { createViewRouter };
