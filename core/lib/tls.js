"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const path = require("path");

function resolveTlsPath(value, fallback) {
  const raw = value || fallback;
  if (!raw) {
    return null;
  }
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function isTlsEnabled() {
  if (process.env.TLS_ENABLED === "false") {
    return false;
  }
  if (process.env.TLS_ENABLED === "true") {
    return true;
  }
  const certFile = resolveTlsPath(process.env.TLS_CERT_FILE);
  const keyFile = resolveTlsPath(process.env.TLS_KEY_FILE);
  return Boolean(certFile && keyFile && fs.existsSync(certFile) && fs.existsSync(keyFile));
}

function loadTlsCredentials() {
  const certFile = resolveTlsPath(process.env.TLS_CERT_FILE, "data/tls/cert.pem");
  const keyFile = resolveTlsPath(process.env.TLS_KEY_FILE, "data/tls/key.pem");
  const caFile = resolveTlsPath(process.env.TLS_CA_FILE);

  if (!certFile || !keyFile || !fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
    throw new Error(`Certificats TLS introuvables (${certFile}, ${keyFile})`);
  }

  const certPem = fs.readFileSync(certFile, "utf8");
  const keyPem = fs.readFileSync(keyFile, "utf8");
  const credentials = {
    cert: certPem,
    key: keyPem,
  };

  if (caFile && fs.existsSync(caFile)) {
    credentials.ca = fs.readFileSync(caFile, "utf8");
  }

  return { certFile, keyFile, caFile, certPem, credentials };
}

function getCertSha256Fingerprint(certPem) {
  try {
    const cert = new crypto.X509Certificate(certPem);
    return cert.fingerprint256.toUpperCase();
  } catch {
    const hash = crypto.createHash("sha256").update(certPem).digest("hex");
    return hash.match(/.{2}/g).join(":").toUpperCase();
  }
}

function getTlsStatus() {
  if (!isTlsEnabled()) {
    return { enabled: false };
  }

  try {
    const { certFile, keyFile, certPem } = loadTlsCredentials();
    const httpsPort = Number(process.env.TLS_PORT || 8443);
    return {
      enabled: true,
      port: httpsPort,
      certFile,
      keyFile,
      signatureAlgorithm: "sha256WithRSAEncryption",
      fingerprintSha256: getCertSha256Fingerprint(certPem),
      httpRedirect: process.env.TLS_HTTP_REDIRECT === "true",
    };
  } catch (err) {
    return { enabled: true, error: err.message };
  }
}

function tuneServerTimeouts(server) {
  if (!server) {
    return;
  }
  const uploadTimeoutMs = Number(process.env.PANEL_UPLOAD_TIMEOUT_MS || 600_000);
  server.requestTimeout = uploadTimeoutMs;
  server.headersTimeout = Math.min(uploadTimeoutMs, 120_000);
  server.keepAliveTimeout = 65_000;
}

function startPanelServers(app, httpPort) {
  if (!isTlsEnabled()) {
    return new Promise((resolve, reject) => {
      const server = app.listen(httpPort, "0.0.0.0", () => resolve({ mode: "http", httpServer: server }));
      tuneServerTimeouts(server);
      server.on("error", reject);
    });
  }

  const { credentials, certPem } = loadTlsCredentials();
  const httpsPort = Number(process.env.TLS_PORT || 8443);
  const fingerprint = getCertSha256Fingerprint(certPem);

  return new Promise((resolve, reject) => {
    const httpsServer = https.createServer(
      {
        ...credentials,
        minVersion: "TLSv1.2",
        honorCipherOrder: true,
      },
      app
    );

    tuneServerTimeouts(httpsServer);
    httpsServer.on("error", reject);
    httpsServer.listen(httpsPort, "0.0.0.0", () => {
      const result = {
        mode: "https",
        httpsServer,
        httpsPort,
        fingerprintSha256: fingerprint,
      };

      if (process.env.TLS_HTTP_REDIRECT === "true") {
        const redirectServer = http.createServer((req, res) => {
          const hostHeader = req.headers.host || `127.0.0.1:${httpPort}`;
          const hostname = hostHeader.replace(/:\d+$/, "");
          const portSuffix = httpsPort === 443 ? "" : `:${httpsPort}`;
          const location = `https://${hostname}${portSuffix}${req.url || "/"}`;
          // 307 pour POST/PUT/etc. — un 301 convertit souvent le POST en GET et perd le body (upload IPFS).
          const status =
            req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" ? 301 : 307;
          res.writeHead(status, { Location: location, "Content-Length": "0" });
          res.end();
        });
        tuneServerTimeouts(redirectServer);
        redirectServer.on("error", reject);
        redirectServer.listen(httpPort, "0.0.0.0", () => {
          result.httpServer = redirectServer;
          result.httpRedirect = true;
          resolve(result);
        });
        return;
      }

      if (process.env.TLS_HTTP_ALSO === "true") {
        const httpServer = app.listen(httpPort, "0.0.0.0");
        tuneServerTimeouts(httpServer);
        httpServer.on("error", reject);
        result.httpServer = httpServer;
      }

      resolve(result);
    });
  });
}

function logTlsStartup(servers, httpPort) {
  if (servers.mode === "http") {
    console.log(`🖥️  TajPanel → http://localhost:${httpPort}`);
    return;
  }

  console.log(`🔒 TajPanel HTTPS → https://localhost:${servers.httpsPort}`);
  console.log(`   Empreinte certificat SHA-256 : ${servers.fingerprintSha256}`);
  if (servers.httpRedirect) {
    console.log(`↪️  Redirection HTTP ${httpPort} → HTTPS ${servers.httpsPort}`);
  } else if (servers.httpServer) {
    console.log(`🖥️  TajPanel HTTP  → http://localhost:${httpPort}`);
  }
}

module.exports = {
  isTlsEnabled,
  getTlsStatus,
  getCertSha256Fingerprint,
  startPanelServers,
  logTlsStartup,
};
