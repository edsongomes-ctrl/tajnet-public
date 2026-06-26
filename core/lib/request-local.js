"use strict";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const LOCAL_WALLET_DENIED_MESSAGE =
  "Wallet nœud réservé à localhost — depuis le LAN ou Internet, connectez MetaMask";

const WAN_PANEL_DENIED_MESSAGE =
  "Interface panel non exposée sur Internet — activez TAJNODE_MODE=vps pour un nœud public (MetaMask requis) ou utilisez un tunnel SSH";

const MATOMO_WAN_DENIED_MESSAGE =
  "Matomo accessible uniquement depuis localhost ou le réseau local (LAN) — utilisez un tunnel SSH depuis Internet";

const NODE_CONFIG_WAN_DENIED_MESSAGE =
  "Configuration du nœud réservée à localhost ou au réseau local (LAN) — utilisez un tunnel SSH depuis Internet";

function isVpsMode() {
  return process.env.TAJNODE_MODE === "vps" || process.env.PUBLIC_PANEL === "true";
}

function isPublicPanelAllowed(req) {
  if (process.env.WAN_PANEL_ACCESS === "true" || isVpsMode()) {
    return true;
  }
  return !isWanRequest(req);
}

function normalizeHost(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  let host = value.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end !== -1) {
      host = host.slice(0, end + 1);
    }
    return host;
  }
  const colon = host.indexOf(":");
  if (colon !== -1) {
    host = host.slice(0, colon);
  }
  return host;
}

function normalizeIp(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  let ip = value.trim();
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }
  if (ip === "::1" || ip === "[::1]") {
    return "127.0.0.1";
  }
  return ip.toLowerCase();
}

function isLoopbackIp(ip) {
  const normalized = normalizeIp(ip);
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function isPrivateIpv4(ip) {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  return false;
}

function isPrivateIpv6(ip) {
  const normalized = normalizeIp(ip);
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80:")) return true;
  return false;
}

function isPrivateIp(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  if (normalized.includes(":")) {
    return isPrivateIpv6(normalized);
  }
  return isPrivateIpv4(normalized);
}

function getClientIp(req) {
  if (!req) {
    return "";
  }
  const trustProxy =
    process.env.TRUST_PROXY === "true" ||
    process.env.TRUST_PROXY === "1" ||
    Number(process.env.TRUST_PROXY) > 0;
  if (trustProxy) {
    const forwarded = req.headers?.["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      return normalizeIp(forwarded.split(",")[0]);
    }
  }
  return normalizeIp(req.ip || req.socket?.remoteAddress || "");
}

/** localhost | lan | wan — basé sur l'IP client (pas le Host HTTP) */
function getRequestZone(req) {
  const ip = getClientIp(req);
  if (isLoopbackIp(ip)) {
    return "localhost";
  }
  if (isPrivateIp(ip)) {
    return "lan";
  }
  if (ip) {
    return "wan";
  }
  return isLocalhostHost(req?.hostname || normalizeHost(req?.headers?.host)) ? "localhost" : "wan";
}

function isLocalhostHost(hostname) {
  return LOCAL_HOSTS.has(normalizeHost(hostname));
}

function isLocalhostRequest(req) {
  return getRequestZone(req) === "localhost";
}

function isLanRequest(req) {
  return getRequestZone(req) === "lan";
}

function isWanRequest(req) {
  return getRequestZone(req) === "wan";
}

/** Par défaut : wallet nœud sur localhost uniquement. LAN : WALLET_LOCAL_LAN=true. Jamais sur WAN. */
function isLocalWalletAllowed(req) {
  const zone = getRequestZone(req);
  if (zone === "wan") {
    return false;
  }
  if (zone === "lan") {
    return process.env.WALLET_LOCAL_LAN === "true";
  }
  return zone === "localhost";
}

function isWanPanelAllowed(req) {
  return isPublicPanelAllowed(req);
}

function isMatomoAllowed(req) {
  const zone = getRequestZone(req);
  return zone === "localhost" || zone === "lan";
}

/** Endpoints tracker (matomo.js / matomo.php) — autorisés sur WAN ; l'admin reste localhost/LAN. */
function isMatomoPublicTrackingPath(req) {
  const pathOnly = String(req?.originalUrl || req?.url || req?.path || "").split("?")[0];
  if (pathOnly !== "/matomo" && !pathOnly.startsWith("/matomo/")) {
    return false;
  }
  const sub = pathOnly.replace(/^\/matomo/, "") || "/";
  if (/^\/(matomo|piwik)\.(js|php)$/i.test(sub)) {
    return true;
  }
  if (/^\/plugins\//i.test(sub) || /^\/js\//i.test(sub) || /^\/misc\//i.test(sub)) {
    return true;
  }
  const query = req?.url || "";
  if (/^\/index\.php$/i.test(sub) && /module=Proxy/i.test(query)) {
    return true;
  }
  return false;
}

function requireLocalhostOperator(req, res, next) {
  if (!isLocalhostRequest(req)) {
    return res.status(403).json({
      success: false,
      error: "Réservé à localhost — opérateur du nœud uniquement",
    });
  }
  next();
}

function requireNonWanOperator(req, res, next) {
  if (isWanRequest(req)) {
    return res.status(403).json({
      success: false,
      error: NODE_CONFIG_WAN_DENIED_MESSAGE,
    });
  }
  next();
}

function rejectWanPanelUi(req, res, next) {
  const pathOnly = req.path || "";
  const isMatomo = pathOnly === "/matomo" || pathOnly.startsWith("/matomo/");
  const isPanelUi =
    pathOnly === "/panel" ||
    pathOnly.startsWith("/panel/") ||
    pathOnly === "/editor" ||
    pathOnly.startsWith("/editor/") ||
    pathOnly === "/wallet" ||
    pathOnly.startsWith("/wallet/");

  if (isMatomo && !isMatomoAllowed(req) && !isMatomoPublicTrackingPath(req)) {
    if (req.method === "GET" || req.method === "HEAD") {
      return res.status(403).type("html").send(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Matomo — accès refusé</title></head>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;line-height:1.5">
<h1>Matomo non exposé sur Internet</h1>
<p>${MATOMO_WAN_DENIED_MESSAGE}</p>
<p><a href="/">Retour à l'accueil</a></p>
</body></html>`);
    }
    return res.status(403).json({ success: false, error: MATOMO_WAN_DENIED_MESSAGE });
  }

  if (!isPanelUi || isPublicPanelAllowed(req)) {
    return next();
  }

  if (req.method === "GET" || req.method === "HEAD") {
    return res.status(403).type("html").send(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>TajNet — accès refusé</title></head>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;line-height:1.5">
<h1>Panel non exposé sur Internet</h1>
<p>${WAN_PANEL_DENIED_MESSAGE}</p>
<p><a href="/">Retour à l'accueil</a></p>
</body></html>`);
  }
  return res.status(403).json({ success: false, error: WAN_PANEL_DENIED_MESSAGE });
}

module.exports = {
  isLocalhostHost,
  isLocalhostRequest,
  isLanRequest,
  isWanRequest,
  getRequestZone,
  getClientIp,
  isLocalWalletAllowed,
  isWanPanelAllowed,
  isPublicPanelAllowed,
  isVpsMode,
  isMatomoAllowed,
  isMatomoPublicTrackingPath,
  requireLocalhostOperator,
  requireNonWanOperator,
  rejectWanPanelUi,
  LOCAL_WALLET_DENIED_MESSAGE,
  WAN_PANEL_DENIED_MESSAGE,
  MATOMO_WAN_DENIED_MESSAGE,
  NODE_CONFIG_WAN_DENIED_MESSAGE,
};
