"use strict";

const { IPFS_GATEWAY_URL } = require("./ipfs");

const IPFS_PUBLIC_GATEWAY_URL = (
  process.env.IPFS_GATEWAY_PUBLIC_URL || "https://dweb.link"
).replace(/\/$/, "");

function getRequestOrigin(req) {
  if (!req) {
    return null;
  }
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  const host = req.get("x-forwarded-host") || req.get("host");
  return host ? `${proto}://${host}` : null;
}

function resolveOrigin(reqOrOrigin) {
  if (!reqOrOrigin) {
    return null;
  }
  if (typeof reqOrOrigin === "string") {
    return reqOrOrigin.replace(/\/$/, "");
  }
  return getRequestOrigin(reqOrOrigin);
}

function buildClientIpfsUrls(cid, reqOrOrigin = null) {
  if (!cid) {
    return {
      gatewayUrl: null,
      publicGatewayUrl: null,
      dwebUrl: null,
      ipfsUri: null,
    };
  }

  const origin = resolveOrigin(reqOrOrigin);
  const publicGatewayUrl = `${IPFS_PUBLIC_GATEWAY_URL}/ipfs/${cid}`;
  const gatewayUrl = origin ? `${origin}/ipfs/${cid}` : publicGatewayUrl;

  return {
    gatewayUrl,
    publicGatewayUrl,
    dwebUrl: publicGatewayUrl,
    ipfsUri: `ipfs://${cid}`,
  };
}

function clientGatewayBase(reqOrOrigin = null) {
  const origin = resolveOrigin(reqOrOrigin);
  return origin ? `${origin}/ipfs` : `${IPFS_PUBLIC_GATEWAY_URL}/ipfs`;
}

async function proxyIpfsGateway(req, res) {
  const subPath = req.path === "/" ? "" : req.path;
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const target = `${IPFS_GATEWAY_URL}/ipfs${subPath}${search}`;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        accept: req.headers.accept || "*/*",
        range: req.headers.range || "",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(120000),
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (["connection", "transfer-encoding", "keep-alive"].includes(lower)) {
        return;
      }
      res.setHeader(key, value);
    });

    const body = Buffer.from(await upstream.arrayBuffer());
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.send(body);
  } catch (err) {
    res.status(502).json({
      error: "Gateway IPFS indisponible",
      detail: err.message,
      hint: "Vérifiez que le nœud IPFS local répond sur IPFS_GATEWAY_URL",
    });
  }
}

module.exports = {
  IPFS_PUBLIC_GATEWAY_URL,
  getRequestOrigin,
  buildClientIpfsUrls,
  clientGatewayBase,
  proxyIpfsGateway,
};
