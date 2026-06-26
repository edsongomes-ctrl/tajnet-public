"use strict";

const http = require("http");
const { getRequestOrigin } = require("./ipfs-gateway");

const MATOMO_URL = (process.env.MATOMO_URL || "http://127.0.0.1:8888").replace(/\/$/, "");
const MATOMO_PUBLIC_URL = (process.env.MATOMO_PUBLIC_URL || MATOMO_URL).replace(/\/$/, "");
const MATOMO_SITE_ID = process.env.MATOMO_SITE_ID || "1";
const MATOMO_INTERNAL = new URL(`${MATOMO_URL}/`);
const REWRITABLE = /text\/html|application\/json/i;
const SKIP_HEADERS = new Set([
  "connection",
  "transfer-encoding",
  "keep-alive",
  "content-length",
  "content-encoding",
  "x-frame-options",
]);
const STRIP_REQUEST_HEADERS = new Set([
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-real-ip",
  "forwarded",
]);

function isLoopbackMatomoHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

function matomoTrackerBase(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "") || "";
    return `//${parsed.host}${path ? `${path}/` : "/"}`;
  } catch {
    return url;
  }
}

function buildClientMatomoUrls(req) {
  const config = getMatomoConfig();
  const explicitPublic =
    process.env.MATOMO_PUBLIC_URL &&
    process.env.MATOMO_PUBLIC_URL.replace(/\/$/, "") !== MATOMO_URL;

  if (explicitPublic) {
    return { url: config.publicUrl, dashboardUrl: config.publicUrl, embedUrl: config.publicUrl };
  }

  const origin = typeof req === "string" ? req.replace(/\/$/, "") : getRequestOrigin(req);
  if (!origin || !isLoopbackMatomoHost(MATOMO_INTERNAL.hostname)) {
    return { url: config.url, dashboardUrl: config.url, embedUrl: config.url };
  }

  const originParsed = new URL(origin);
  const embedUrl = `${origin.replace(/\/$/, "")}/matomo/`;
  const port = MATOMO_INTERNAL.port || "8888";
  const dashboardUrl = isLoopbackMatomoHost(originParsed.hostname)
    ? `${originParsed.protocol}//${originParsed.hostname}:${port}`
    : embedUrl;

  return { url: dashboardUrl, dashboardUrl, embedUrl };
}

function rewriteMatomoText(text, clientBase) {
  const client = clientBase.replace(/\/$/, "");
  const clientSlash = `${client}/`;
  const internal = MATOMO_URL.replace(/\/$/, "");
  const variants = new Set([
    internal,
    internal.replace("127.0.0.1", "localhost"),
    internal.replace("localhost", "127.0.0.1"),
    `${internal}/`,
    `${internal.replace("127.0.0.1", "localhost")}/`,
    `${internal.replace("localhost", "127.0.0.1")}/`,
  ]);
  let out = String(text);
  for (const variant of variants) {
    out = out.split(variant).join(clientSlash);
  }
  out = out.replace(new RegExp(`${client}//`, "g"), `${client}/`);

  if (/<head[^>]*>/i.test(out) && !/<base\s/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1><base href="${clientSlash}">`);
  }

  return out;
}

function proxyMatomo(req, res) {
  const clientUrls = buildClientMatomoUrls(req);
  const embedBase = clientUrls.embedUrl;
  const targetPath = req.url || "/";

  const headers = { ...req.headers, host: MATOMO_INTERNAL.host, "accept-encoding": "identity" };
  delete headers.connection;
  delete headers["content-length"];
  for (const key of Object.keys(headers)) {
    if (STRIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      delete headers[key];
    }
  }

  return new Promise((resolve, reject) => {
    const proxyReq = http.request(
      {
        hostname: MATOMO_INTERNAL.hostname,
        port: MATOMO_INTERNAL.port || 80,
        path: targetPath,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        const contentType = proxyRes.headers["content-type"] || "";
        const shouldRewrite = REWRITABLE.test(contentType);
        const chunks = [];

        proxyRes.on("data", (chunk) => chunks.push(chunk));
        proxyRes.on("end", () => {
          let body = Buffer.concat(chunks);
          if (shouldRewrite && body.length) {
            body = Buffer.from(rewriteMatomoText(body.toString("utf8"), embedBase));
          }

          res.status(proxyRes.statusCode || 502);
          for (const [key, value] of Object.entries(proxyRes.headers)) {
            const lower = key.toLowerCase();
            if (SKIP_HEADERS.has(lower)) {
              continue;
            }
            if (lower === "location" && typeof value === "string") {
              res.setHeader(key, rewriteMatomoText(value, embedBase));
              continue;
            }
            res.setHeader(key, value);
          }
          res.setHeader("content-length", body.length);

          if (req.method === "HEAD") {
            res.end();
          } else {
            res.end(body);
          }
          resolve();
        });
      }
    );

    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.status(502).json({ error: "Matomo indisponible", detail: err.message });
      }
      reject(err);
    });

    req.pipe(proxyReq);
  });
}

function resolveMatomoTrackingUrl(req = null) {
  const explicit = (process.env.MATOMO_PUBLIC_URL || "").replace(/\/$/, "");
  if (explicit && explicit !== MATOMO_URL) {
    return `${explicit}/`;
  }
  const endpoint = (process.env.DISCOVER_NODE_ENDPOINT || "").replace(/\/$/, "");
  if (endpoint) {
    return `${endpoint}/matomo/`;
  }
  if (req) {
    const { embedUrl } = buildClientMatomoUrls(req);
    if (embedUrl) {
      return embedUrl.endsWith("/") ? embedUrl : `${embedUrl}/`;
    }
  }
  return `${MATOMO_PUBLIC_URL.replace(/\/$/, "")}/`;
}

function buildMatomoSnippet(matomoUrl = MATOMO_PUBLIC_URL, siteId = MATOMO_SITE_ID) {
  const base = matomoTrackerBase(matomoUrl);
  return `<!-- Matomo TajNet -->
<script>
  var _paq = window._paq = window._paq || [];
  _paq.push(['trackPageView']);
  _paq.push(['enableLinkTracking']);
  (function() {
    var u="${base}";
    _paq.push(['setTrackerUrl', u+'matomo.php']);
    _paq.push(['setSiteId', '${siteId}']);
    var d=document,g=d.createElement('script'),s=d.getElementsByTagName('script')[0];
    g.async=true; g.src=u+'matomo.js'; s.parentNode.insertBefore(g,s);
  })();
</script>`;
}

function buildPublishablePage({ html = "", css = "", js = "", title = "Page TajNet" }) {
  const safeTitle = String(title).replace(/[<>&"]/g, "");
  const jsBlock = js ? `<script>${js}</script>` : "";
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>${css}</style>
</head>
<body>${html}${jsBlock}</body>
</html>`;
}

function injectMatomoIntoHtml(html, snippet) {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${snippet}\n</head>`);
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${snippet}\n</body>`);
  }
  return `${html}\n${snippet}`;
}

function getMatomoConfig() {
  return {
    url: MATOMO_URL,
    publicUrl: MATOMO_PUBLIC_URL,
    siteId: MATOMO_SITE_ID,
    tracking: Boolean(MATOMO_SITE_ID),
  };
}

module.exports = {
  MATOMO_URL,
  MATOMO_PUBLIC_URL,
  MATOMO_SITE_ID,
  matomoTrackerBase,
  buildClientMatomoUrls,
  proxyMatomo,
  buildMatomoSnippet,
  resolveMatomoTrackingUrl,
  buildPublishablePage,
  injectMatomoIntoHtml,
  getMatomoConfig,
};
