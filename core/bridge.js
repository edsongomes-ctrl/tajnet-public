"use strict";

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const { IS_PUBLIC, EDITION } = require("./lib/edition");
const { loadPlugins, loadPluginHandler } = require("./lib/plugins");
const { GuardDaemon } = require("./lib/guard");
const { createGuardRouter, requireGuardSession } = require("./routes/guard");
const { createPaymentsRouter } = require("./routes/payments");
const { createAnnounceRouter } = require("./routes/announce");
const { createDiscoverRouter } = require("./routes/discover");
const { createViewRouter } = require("./routes/view");
const { createPinServiceRouter } = require("./routes/pin-service");
const { createPinRewardsRouter } = require("./routes/pin-rewards");
const { createBranWebRouter } = require("./routes/bran-web");
const { BranPublishService } = require("./lib/bran-publish");
const { announcePublication, initAnnounce } = require("./lib/announce");
const { DiscoverIndexer } = require("./lib/discover");
const { PinService } = require("./lib/pin-service");
const { PinRewardLedger } = require("./lib/pin-rewards");
const { ContentPoolLedger } = require("./lib/content-pool");
const { ContentMetricsStore } = require("./lib/content-metrics");
const { ContentStakingLedger } = require("./lib/content-staking");
const { StakeService } = require("./lib/stake-service");
const { createContentStakingRouter } = require("./routes/content-staking");
const { createContentMetricsRouter, extractIpfsCid } = require("./routes/content-metrics");
const matomoTrustedHosts = IS_PUBLIC ? null : require("./lib/matomo-trusted-hosts");
const { getStatus: getTajcoinStatus } = require("./lib/tajcoin");
const { getTlsStatus, startPanelServers, logTlsStartup } = require("./lib/tls");
const {
  getRequestZone,
  isLocalWalletAllowed,
  isLocalhostRequest,
  isWanRequest,
  isMatomoAllowed,
  isMatomoPublicTrackingPath,
  isVpsMode,
  isPublicPanelAllowed,
  rejectWanPanelUi,
  WAN_PANEL_DENIED_MESSAGE,
  MATOMO_WAN_DENIED_MESSAGE,
  requireNonWanOperator,
} = require("./lib/request-local");
const matomoLib = IS_PUBLIC ? null : require("./lib/matomo");
const { loadLandingProfile, saveLandingProfile, resolveLandingIndex } = require("./lib/landing-profile");
const { walletDatStatus } = require("./lib/tajcoin-wallet-file");
const { tajcoinNodesStatus } = require("./lib/tajcoin-conf-nodes");
const { createLandingRouter, createTajcoinWalletRouter, createTajcoinNodesRouter } = require("./routes/node-admin");
const { getIpfsStatus, addHtmlToIpfs, addFileToIpfs } = require("./lib/ipfs");
const {
  buildClientIpfsUrls,
  clientGatewayBase,
  IPFS_PUBLIC_GATEWAY_URL,
  proxyIpfsGateway,
} = require("./lib/ipfs-gateway");

const matomoHelpers = matomoLib || {};
const {
  buildPublishablePage = (p) => p.html || "",
  buildMatomoSnippet = () => "",
  buildClientMatomoUrls = () => ({}),
  injectMatomoIntoHtml = (html) => html,
  getMatomoConfig = () => ({ tracking: false }),
  proxyMatomo = (_req, _res, next) => next(),
  resolveMatomoTrackingUrl = () => "",
  MATOMO_URL = "",
  MATOMO_SITE_ID = "",
} = matomoHelpers;

const IPFS_GATEWAY_URL = (process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const IPFS_MAX_UPLOAD_MB = Number(process.env.IPFS_MAX_UPLOAD_MB || 100);
const PANEL_PORT = Number(process.env.PANEL_PORT || 8090);

const isDockerLayout = fs.existsSync(path.join(__dirname, "panel", "src"));
const ROOT_DIR = isDockerLayout ? __dirname : path.join(__dirname, "..");
const DATA_DIR = process.env.TAJNET_DATA_DIR || path.join(ROOT_DIR, "data");
const PLUGINS_DIR = process.env.PLUGINS_DIR || path.join(ROOT_DIR, "plugins");
const TAJCOIN_DATA_DIR =
  process.env.TAJCOIN_DATA_DIR || path.join(ROOT_DIR, "Tajcoin", "data");
const PANEL_DIR = path.join(ROOT_DIR, "panel", "src");
const LANDING_DIR = path.join(ROOT_DIR, "panel", "landing");
const EDITOR_DIR = path.join(ROOT_DIR, "panel", "editor");
const WALLET_DIR = path.join(ROOT_DIR, "panel", "wallet");
const VIEW_DIR = path.join(ROOT_DIR, "panel", "view");
const CV_DIR = path.join(ROOT_DIR, "panel", "cv");
const BRAN_WEB_DIR = path.join(PLUGINS_DIR, "bran-web");
const FUTUREMEN_DIR = path.join(ROOT_DIR, "panel", "futuremen");
const PULSE_DIR = path.join(ROOT_DIR, "panel", "pulse");
const SHARED_DIR = path.join(ROOT_DIR, "panel", "shared");
const PUBLIC_LANDING = path.join(LANDING_DIR, "public", "index.html");
function getLandingIndex() {
  return resolveLandingIndex({ landingDir: LANDING_DIR, dataDir: DATA_DIR, isPublic: IS_PUBLIC });
}
const walletRoutes = require("./routes/wallet");

const app = express();
if (
  process.env.TRUST_PROXY === "true" ||
  process.env.TRUST_PROXY === "1" ||
  Number(process.env.TRUST_PROXY) > 0
) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
}
const guard = new GuardDaemon({ walletDir: TAJCOIN_DATA_DIR });
const guardRouter = createGuardRouter(guard);
const guardGate = requireGuardSession(guard);
const announceRouter = createAnnounceRouter();
const discover = new DiscoverIndexer({ dataDir: path.join(DATA_DIR, "discover") });
discover.load();
const rewardLedger = new PinRewardLedger({ dataDir: path.join(DATA_DIR, "discover") });
rewardLedger.load();
const contentPool = new ContentPoolLedger({ dataDir: path.join(DATA_DIR, "discover") });
contentPool.load();
contentPool.syncLegacy({ ledger: rewardLedger, pins: discover.pins });
discover.setRewardLedger(rewardLedger);
discover.setContentPool(contentPool);
const metricsStore = new ContentMetricsStore({ dataDir: path.join(DATA_DIR, "discover") });
metricsStore.load();
const stakingLedger = new ContentStakingLedger({ dataDir: path.join(DATA_DIR, "discover") });
stakingLedger.load();
discover.setMetricsStore(metricsStore);
discover.setStakingLedger(stakingLedger);

const cvStub = {
  status: () => ({ enabled: false, edition: EDITION }),
  init: () => ({ totalSearchable: 0, localCount: 0, discoverCvCount: 0 }),
  upsert: () => {},
  setDiscover: () => {},
};

let cvIndex;
let cvAccessService;
let futuremenRouter = null;
let pulseRouter = null;
let superCvRouter = null;
if (IS_PUBLIC) {
  cvIndex = cvStub;
  cvAccessService = { status: () => ({ enabled: false }), init: async () => {} };
} else {
  const { CvSemanticIndex } = require("./lib/cv-index");
  const { CvAccessService } = require("./lib/cv-access");
  const { createFuturemenRouter } = require("./routes/futuremen");
  const { createPulseRouter } = require("./routes/pulse");
  const { createSuperCvRouter } = require("./routes/super-cv");
  cvIndex = new CvSemanticIndex({
    dataDir: path.join(DATA_DIR, "super-cv"),
    discover,
  });
  cvAccessService = new CvAccessService({
    dataDir: path.join(DATA_DIR, "super-cv"),
  });
  discover.setCvGate({ cvIndex, cvAccess: cvAccessService });
  futuremenRouter = createFuturemenRouter(discover);
  pulseRouter = createPulseRouter(discover);
  superCvRouter = createSuperCvRouter(cvIndex, {
    pluginsDir: PLUGINS_DIR,
    cvAccess: cvAccessService,
  });
}

const pinService = new PinService({ discover, contentPool });
pinService.setContentPool(contentPool);
const stakeService = new StakeService({ contentPool, stakingLedger, metricsStore });
const paymentsRouter = createPaymentsRouter({ guard, pinService, stakeService });
const discoverRouter = createDiscoverRouter(discover, pinService);
const viewRouter = createViewRouter(discover, {
  metricsStore,
  stakingLedger,
  contentPool,
  cvIndex,
  cvAccess: cvAccessService,
});
const pinServiceRouter = createPinServiceRouter(pinService);
const pinRewardsRouter = createPinRewardsRouter({
  ledger: rewardLedger,
  discover,
  contentPool,
  metricsStore,
});
const contentStakingRouter = createContentStakingRouter({
  stakeService,
  stakingLedger,
  contentPool,
  metricsStore,
});
const contentMetricsRouter = createContentMetricsRouter({ metricsStore, contentPool });
const branPublishService = new BranPublishService();
const branWebRouter = createBranWebRouter({
  pluginsDir: PLUGINS_DIR,
  branPublishService,
});

const uploadDir = IS_PUBLIC
  ? path.join(DATA_DIR, "uploads")
  : path.join(PLUGINS_DIR, "super-cv", "uploads");
const ipfsUploadDir = path.join(DATA_DIR, "ipfs_uploads");
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(ipfsUploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });
const ipfsUpload = multer({
  dest: ipfsUploadDir,
  limits: { fileSize: IPFS_MAX_UPLOAD_MB * 1024 * 1024 },
});

function withMulter(middleware) {
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (!err) {
        return next();
      }
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: "Fichier trop volumineux",
          message: `Taille max : ${IPFS_MAX_UPLOAD_MB} Mo`,
        });
      }
      if (err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({
          error: "Champ fichier invalide",
          message: "Envoyez un fichier via le champ « file »",
        });
      }
      return res.status(400).json({
        error: "Upload invalide",
        detail: err.message,
      });
    });
  };
}

if (!IS_PUBLIC) {
  app.use("/matomo", (req, res, next) => {
    if (!isMatomoAllowed(req) && !isMatomoPublicTrackingPath(req)) {
      if (req.method === "GET" || req.method === "HEAD") {
        return res.status(403).type("html").send(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Matomo — accès refusé</title></head>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;line-height:1.5">
<h1>Matomo non exposé sur Internet</h1>
<p>${MATOMO_WAN_DENIED_MESSAGE}</p>
</body></html>`);
      }
      return res.status(403).json({ success: false, error: MATOMO_WAN_DENIED_MESSAGE });
    }
    const pathOnly = req.originalUrl.split("?")[0];
    if (pathOnly === "/matomo") {
      const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
      return res.redirect(302, `/matomo/${query}`);
    }
    return proxyMatomo(req, res).catch(next);
  });
}

app.use(express.json({ limit: "10mb" }));
app.use(rejectWanPanelUi);

app.use("/ipfs", (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const cid = extractIpfsCid(req.path || req.url);
  if (cid && req.method === "GET") {
    const referer = String(req.headers.referer || req.headers.referrer || "");
    const fromViewEmbed = referer.includes("/view");
    if (!fromViewEmbed) {
      try {
        metricsStore.recordVisit(cid, { source: "gateway" });
      } catch {
        /* ignore metrics errors */
      }
    }
  }
  return proxyIpfsGateway(req, res).catch(next);
});

async function trackAnnouncement(announce, context = {}) {
  if (announce?.status === "broadcast") {
    await discover.ingestLocalAnnouncement(announce, context);
  }
  return announce;
}

function announceExtras(extra = {}) {
  const endpoint =
    (discover.profile?.public && discover.profile?.endpoint) ||
    process.env.DISCOVER_NODE_ENDPOINT ||
    null;
  return endpoint ? { ...extra, publisherEndpoint: endpoint } : extra;
}

async function publishAnnouncement(payload) {
  return announcePublication({
    ...payload,
    extra: announceExtras(payload.extra || {}),
    rewardLedger,
    contentPool,
  });
}

branPublishService.setDeps({
  addHtmlToIpfs,
  publishAnnouncement,
  trackAnnouncement,
  discover,
  buildClientIpfsUrls,
});

async function getMatomoStatus(req) {
  if (IS_PUBLIC) {
    return { enabled: false, edition: EDITION, online: false, tracking: false };
  }
  const config = getMatomoConfig();
  const zone = getRequestZone(req);
  const trackingUrl = resolveMatomoTrackingUrl(req);
  const trackingSnippet = buildMatomoSnippet(trackingUrl, config.siteId);

  if (!isMatomoAllowed(req)) {
    return {
      online: false,
      allowed: false,
      restricted: true,
      tracking: Boolean(config.tracking),
      requestZone: zone,
      siteId: config.siteId,
      publicUrl: config.publicUrl,
      trackingUrl,
      trackingSnippet,
      message: MATOMO_WAN_DENIED_MESSAGE,
    };
  }

  const clientUrls = buildClientMatomoUrls(req);
  try {
    const res = await fetch(MATOMO_URL, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    });
    const online = res.ok || res.status === 301 || res.status === 302;
    return {
      online,
      allowed: true,
      restricted: false,
      requestZone: zone,
      ...clientUrls,
      internalUrl: config.url,
      publicUrl: config.publicUrl,
      trackingUrl: resolveMatomoTrackingUrl(req),
      trackingSnippet: buildMatomoSnippet(resolveMatomoTrackingUrl(req), config.siteId),
      siteId: config.siteId,
      tracking: online && config.tracking,
    };
  } catch (err) {
    return {
      online: false,
      allowed: true,
      restricted: false,
      requestZone: zone,
      ...clientUrls,
      internalUrl: config.url,
      publicUrl: config.publicUrl,
      trackingUrl: resolveMatomoTrackingUrl(req),
      trackingSnippet: buildMatomoSnippet(resolveMatomoTrackingUrl(req), config.siteId),
      siteId: config.siteId,
      tracking: false,
      error: err.message,
    };
  }
}

function setPublicReadCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Accept");
}

app.options("/api/status", (_req, res) => {
  setPublicReadCors(res);
  res.sendStatus(204);
});

app.get("/api/status", async (req, res) => {
  setPublicReadCors(res);
  const plugins = loadPlugins(PLUGINS_DIR);
  const [ipfs, tajcoin, matomo, announce] = await Promise.all([
    getIpfsStatus(),
    getTajcoinStatus(),
    getMatomoStatus(req),
    initAnnounce(),
  ]);

  const status =
    ipfs.online && tajcoin.online ? "online" : ipfs.online || tajcoin.online ? "degraded" : "degraded";

  res.json({
    engine: "online",
    status,
    edition: EDITION,
    version: "0.1.0-graine",
    localWalletAllowed: isLocalWalletAllowed(req),
    localWalletLanOpen: process.env.WALLET_LOCAL_LAN === "true",
    requestZone: getRequestZone(req),
    nodeConfigAllowed: !isWanRequest(req),
    wanPanelAccess: process.env.WAN_PANEL_ACCESS === "true",
    publicPanel: isVpsMode(),
    tajnodeMode: isVpsMode() ? "vps" : "local",
    landing: loadLandingProfile(DATA_DIR),
    walletDat: isLocalhostRequest(req) ? walletDatStatus() : { available: false, restricted: true },
    tajcoinConf: isLocalhostRequest(req) ? tajcoinNodesStatus() : { available: false, restricted: true },
    discover: discover.status(),
    pinService: pinService.status(),
    pinRewards: { ...rewardLedger.status(), contentPool: contentPool.status() },
    contentStaking: stakingLedger.status(),
    contentMetrics: metricsStore.status(),
    superCv: cvIndex.status(),
    cvAccess: cvAccessService.status(),
    branWeb: loadPluginHandler(PLUGINS_DIR, "bran-web")?.status?.() || null,
    branPublish: branPublishService.status(),
    ipfs,
    nodeId: ipfs.nodeId || null,
    ipfsClient: {
      gatewayBase: clientGatewayBase(req),
      publicGateway: IPFS_PUBLIC_GATEWAY_URL,
    },
    guard: guard.status(),
    announce,
    tajcoin,
    matomo: IS_PUBLIC ? { enabled: false, edition: EDITION } : matomo,
    tls: getTlsStatus(),
    plugins: plugins.filter((p) => p.active).map((p) => p.id),
  });
});

app.get("/api/editor/config", async (req, res) => {
  const [ipfs, matomo] = await Promise.all([getIpfsStatus(), getMatomoStatus(req)]);
  res.json({
    ipfs: {
      ...ipfs,
      gateway: clientGatewayBase(req),
      publicGateway: IPFS_PUBLIC_GATEWAY_URL,
    },
    matomo,
    guard: guard.status(),
  });
});

app.post("/api/publish", guardGate, async (req, res) => {
  const { html = "", css = "", js = "", title = "Page TajNet" } = req.body || {};

  if (!html && !css) {
    return res.status(400).json({ error: "Contenu vide", message: "Ajoutez du contenu avant de publier" });
  }

  try {
    const ipfs = await getIpfsStatus();
    if (!ipfs.online) {
      return res.status(503).json({ error: "IPFS offline", message: "Le nœud IPFS local est injoignable" });
    }

    let page = buildPublishablePage({ html, css, js, title });
    const matomo = await getMatomoStatus(req);
    let matomoInjected = false;

    if (matomo.tracking && matomo.allowed !== false && !IS_PUBLIC) {
      const snippet = buildMatomoSnippet(resolveMatomoTrackingUrl(req), matomo.siteId);
      page = injectMatomoIntoHtml(page, snippet);
      matomoInjected = true;
    }

    const { cid, fileCid } = await addHtmlToIpfs(page);
    const urls = buildClientIpfsUrls(cid, req);

    const announce = await trackAnnouncement(
      await publishAnnouncement({
        type: "page",
        contentCid: cid,
        title,
        extra: { fileCid, matomoInjected },
      }),
      { title }
    );

    await discover.recordPin({
      contentCid: cid,
      title,
      sourceTxid: announce?.txid || null,
      paid: false,
    });

    res.json({
      message: "Page publiée sur IPFS",
      cid,
      fileCid,
      ...urls,
      pinned: true,
      matomoInjected,
      matomoSiteId: MATOMO_SITE_ID,
      guardSessionId: req.guardSessionId || null,
      announce,
    });
  } catch (err) {
    res.status(500).json({ error: "Publication échouée", detail: err.message });
  }
});

function buildIpfsUrls(cid, req) {
  return buildClientIpfsUrls(cid, req);
}

app.post("/api/ipfs/upload", guardGate, withMulter(ipfsUpload.single("file")), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Fichier manquant", message: "Envoyez un fichier via le champ « file »" });
  }

  const wrap = req.body?.wrap === "true" || req.body?.wrap === true;

  try {
    const ipfs = await getIpfsStatus();
    if (!ipfs.online) {
      return res.status(503).json({ error: "IPFS offline", message: "Le nœud IPFS local est injoignable" });
    }

    const originalName = req.file.originalname || req.file.filename;
    const result = await addFileToIpfs(req.file.path, originalName, {
      wrapWithDirectory: wrap,
    });

    const urls = buildIpfsUrls(result.cid, req);

    const announce = await trackAnnouncement(
      await publishAnnouncement({
        type: "file",
        contentCid: result.cid,
        title: originalName,
        extra: {
          fileCid: result.fileCid,
          size: result.size || req.file.size,
          wrapWithDirectory: wrap,
        },
      }),
      { title: originalName }
    );

    await discover.recordPin({
      contentCid: result.cid,
      title: originalName,
      sourceTxid: announce?.txid || null,
      paid: false,
    });

    res.json({
      message: "Fichier ajouté sur IPFS",
      cid: result.cid,
      fileCid: result.fileCid,
      name: result.name || originalName,
      size: result.size || req.file.size,
      pinned: true,
      wrapWithDirectory: wrap,
      guardSessionId: req.guardSessionId || null,
      announce,
      ...urls,
    });
  } catch (err) {
    res.status(500).json({ error: "Upload IPFS échoué", detail: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

app.use("/api/guard", guardRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/announce", announceRouter);
app.use("/api/discover", (req, res, next) => {
  const readOnly = req.method === "GET" && String(req.path || "").startsWith("/entries");
  if (readOnly || req.method === "OPTIONS") {
    setPublicReadCors(res);
    if (req.method === "OPTIONS") return res.sendStatus(204);
  }
  next();
});
app.use("/api/discover", discoverRouter);
if (!IS_PUBLIC && futuremenRouter) {
  app.use("/api/futuremen", (req, res, next) => {
    if (req.method === "GET" || req.method === "OPTIONS") {
      setPublicReadCors(res);
      if (req.method === "OPTIONS") return res.sendStatus(204);
    }
    next();
  });
  app.use("/api/futuremen", futuremenRouter);
}
if (!IS_PUBLIC && pulseRouter) {
  app.use("/api/pulse", pulseRouter);
}
app.use("/api/view", viewRouter);
app.use("/api/pin-service", pinServiceRouter);
app.use("/api/pin-rewards", pinRewardsRouter);
app.use("/api/content-staking", contentStakingRouter);
app.use("/api/content-metrics", contentMetricsRouter);
if (!IS_PUBLIC && superCvRouter) {
  app.use("/api/super-cv", superCvRouter);
}
app.use("/api/bran-web", branWebRouter);

app.get("/api/plugins", (_req, res) => {
  res.json({ plugins: loadPlugins(PLUGINS_DIR) });
});

app.post("/api/upload", guardGate, withMulter(upload.single("file")), async (req, res) => {
  if (IS_PUBLIC) {
    return res.status(501).json({
      error: "Upload plugin unavailable",
      message: "Super CV is not included in the public edition. Use Bran Web or IPFS upload.",
    });
  }
  if (!req.file) {
    return res.status(400).json({ error: "Fichier manquant" });
  }

  try {
    const handler = loadPluginHandler(PLUGINS_DIR, "super-cv");
    if (!handler?.processCV) {
      return res.status(501).json({ error: "Plugin super-cv indisponible" });
    }

    const originalName = req.file.originalname || req.file.filename;
    const ext = path.extname(originalName).toLowerCase().replace(/^\./, "");

    if (handler.isSupportedFormat && !handler.isSupportedFormat(ext)) {
      return res.status(400).json({
        error: "Format non supporté",
        message: "Formats acceptés : PDF, TXT, JSON",
      });
    }

    const result = await handler.processCV(req.file.path, {
      filename: originalName,
    });

    const ipfsResult = await addFileToIpfs(req.file.path, originalName);
    const ipfsUrls = buildClientIpfsUrls(ipfsResult.cid, req);

    const announce = await trackAnnouncement(
      await publishAnnouncement({
        type: "cv",
        contentCid: ipfsResult.cid,
        title: originalName,
        extra: { skills: result.skills || [], format: result.format, pages: result.pages },
      }),
      { title: originalName }
    );

    if (result.profile) {
      result.profile.skills = result.skills;
      result.profile.contentCid = ipfsResult.cid;
      result.profile.txid = announce?.txid || null;
      result.profile.metadataCid = announce?.metadataCid || null;
      cvIndex.upsert(result.profile);
    }

    res.json({
      message: "CV indexé avec succès",
      data: { ...result, ipfs: { ...ipfsResult, ...ipfsUrls } },
      ...ipfsUrls,
      guardSessionId: req.guardSessionId || null,
      announce,
    });
  } catch (err) {
    res.status(err.message?.includes("PDF") || err.message?.includes("Format") ? 400 : 500).json({
      error: "Erreur d'indexation",
      detail: err.message,
    });
  }
});

app.use("/api/wallet", walletRoutes);
app.use("/api/landing", createLandingRouter({ dataDir: DATA_DIR, loadLandingProfile, saveLandingProfile }));
app.use("/api/tajcoin/wallet", createTajcoinWalletRouter());
app.use("/api/tajcoin/nodes", createTajcoinNodesRouter());

app.use("/editor", express.static(EDITOR_DIR));
app.get("/editor", (_req, res) => {
  res.sendFile(path.join(EDITOR_DIR, "index.html"));
});

app.use("/wallet", express.static(WALLET_DIR));
app.get("/wallet", (_req, res) => {
  res.sendFile(path.join(WALLET_DIR, "index.html"));
});

app.use("/panel", express.static(PANEL_DIR));
app.get("/panel", (_req, res) => {
  res.sendFile(path.join(PANEL_DIR, "index.html"));
});

app.use("/view", express.static(VIEW_DIR));
app.get("/view", (_req, res) => {
  res.sendFile(path.join(VIEW_DIR, "index.html"));
});

if (!IS_PUBLIC) {
  app.use("/cv", express.static(CV_DIR));
  app.get("/cv", (_req, res) => {
    res.sendFile(path.join(CV_DIR, "index.html"));
  });
}

app.use("/bran-web", express.static(BRAN_WEB_DIR));
app.get("/bran-web", (_req, res) => {
  res.sendFile(path.join(BRAN_WEB_DIR, "index.html"));
});

function servePublicPageWithMatomo(req, res, htmlPath) {
  let html = fs.readFileSync(htmlPath, "utf8");
  if (MATOMO_SITE_ID) {
    html = injectMatomoIntoHtml(
      html,
      buildMatomoSnippet(resolveMatomoTrackingUrl(req), MATOMO_SITE_ID)
    );
  }
  res.type("html").send(html);
}

if (!IS_PUBLIC) {
  app.use("/futuremen", express.static(FUTUREMEN_DIR));
  app.get(["/futuremen", "/futuremen/"], (req, res) => {
    servePublicPageWithMatomo(req, res, path.join(FUTUREMEN_DIR, "futuremen.html"));
  });
  app.get("/futuremen.html", (_req, res) => {
    res.redirect(301, "/futuremen");
  });

  app.use("/pulse", requireNonWanOperator);
  app.use("/pulse", express.static(PULSE_DIR));
  app.get(["/pulse", "/pulse/"], requireNonWanOperator, (req, res) => {
    servePublicPageWithMatomo(req, res, path.join(PULSE_DIR, "pulse.html"));
  });
  app.get("/pulse.html", (_req, res) => {
    res.redirect(301, "/pulse");
  });
}

app.get("/", (_req, res) => {
  res.sendFile(getLandingIndex());
});
app.use(express.static(LANDING_DIR, { index: false }));
app.use("/shared", express.static(SHARED_DIR));

async function init() {
  console.log(
    IS_PUBLIC
      ? "🌿 Initialisation TajNet — édition publique v1.0 (Bran Web)…"
      : "🌿 Initialisation du moteur TajNet (Graine v0.1)…"
  );

  const [ipfs, tajcoin] = await Promise.all([getIpfsStatus(), getTajcoinStatus()]);

  if (ipfs.online) {
    console.log(`✅ IPFS connecté — nœud : ${ipfs.nodeId}`);
  } else {
    console.warn(`⚠️  IPFS non joignable —`, ipfs.error);
  }

  if (tajcoin.online) {
    console.log(`✅ Tajcoin connecté — ${tajcoin.blocks} blocs`);
  } else {
    console.warn(`⚠️  Tajcoin non joignable —`, tajcoin.error);
  }

  const plugins = loadPlugins(PLUGINS_DIR);
  console.log(`📦 Plugins détectés : ${plugins.length}`);

  const matomoHosts = matomoTrustedHosts?.syncMatomoTrustedHosts?.();
  if (matomoHosts?.synced) {
    console.log(`📊 Matomo — hôtes de confiance synchronisés (${matomoHosts.hosts.length})`);
  } else if (matomoHosts?.reason === "config_missing") {
    console.log("📊 Matomo — config absente (trusted hosts non synchronisés)");
  } else if (matomoHosts?.reason === "write_failed") {
    console.warn(`⚠️  Matomo — impossible de mettre à jour trusted_hosts (${matomoHosts.error})`);
  }

  await guard.init();
  const announceStatus = await initAnnounce();
  if (announceStatus.enabled && !announceStatus.error) {
    console.log(
      `📣 Annonces Tajcoin — compte ${announceStatus.account} (${announceStatus.utxoCount || 0} UTXO, ${announceStatus.balanceTaj || 0} TAJ)`
    );
  } else if (announceStatus.enabled && announceStatus.error) {
    console.warn(`⚠️  Annonces Tajcoin —`, announceStatus.error);
  }

  const discoverStatus = await discover.init();
  pinService.setDiscover(discover);
  stakeService.setDeps({ contentPool, stakingLedger, metricsStore });
  await pinService.init();
  await stakeService.init();
  if (!IS_PUBLIC) {
    const cvStatus = cvIndex.init();
    cvIndex.setDiscover(discover);
    await cvAccessService.init();
    console.log(
      `📄 Super CV — ${cvStatus.totalSearchable} profil(s) indexé(s) (${cvStatus.localCount} local, ${cvStatus.discoverCvCount} Discover)`
    );
  }
  await branPublishService.init();
  if (discoverStatus.enabled) {
    console.log(
      `🔍 Discover actif — ${discoverStatus.entryCount} entrée(s), ${discoverStatus.pinCount} pin(s), bloc ${discoverStatus.lastScannedHeight ?? "…"}`
    );
  } else {
    console.log(
      `🔍 Discover inactif — ${discoverStatus.pinCount} pin(s) local(aux) — activez via DISCOVER_ENABLED=true ou TajPanel`
    );
  }

  const servers = await startPanelServers(app, PANEL_PORT);
  logTlsStartup(servers, PANEL_PORT);
  const baseUrl =
    servers.mode === "https"
      ? `https://localhost:${servers.httpsPort}`
      : `http://localhost:${PANEL_PORT}`;
  if (servers.mode === "https") {
    console.log(`🎨 Éditeur   → ${baseUrl}/editor`);
    if (!IS_PUBLIC) {
      console.log(`⏳ Futuremen → ${baseUrl}/futuremen`);
      console.log(`📡 Pulse     → ${baseUrl}/pulse (LAN uniquement)`);
    }
    if (IS_PUBLIC) console.log(`🌐 Bran Web  → ${baseUrl}/bran-web/`);
    console.log(`💰 Wallet    → ${baseUrl}/wallet`);
  } else {
    console.log(`🎨 Éditeur   → ${baseUrl}/editor`);
    if (!IS_PUBLIC) {
      console.log(`⏳ Futuremen → ${baseUrl}/futuremen`);
      console.log(`📡 Pulse     → ${baseUrl}/pulse (LAN uniquement)`);
    }
    if (IS_PUBLIC) console.log(`🌐 Bran Web  → ${baseUrl}/bran-web/`);
    console.log(`💰 Wallet    → ${baseUrl}/wallet`);
  }
}

init().catch((err) => {
  console.error("❌ Échec démarrage moteur:", err);
  process.exit(1);
});
