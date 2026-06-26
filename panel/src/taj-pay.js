"use strict";

function isLocalhostClient() {
  const host = window.location.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

async function loadTajPayOptions(apiBase) {
  try {
    const res = await fetch(`${apiBase}/pay-options`, {
      headers: walletPayHeaders(),
    });
    const data = await res.json();
    return res.ok ? data : null;
  } catch {
    return null;
  }
}

function walletPayHeaders() {
  if (typeof tajCoinAuth === "undefined") return {};
  tajCoinAuth.restoreSession();
  if (!tajCoinAuth.sessionId) return {};
  return { "X-Wallet-Session": tajCoinAuth.sessionId };
}

function needsWalletSession(options) {
  if (walletPayHeaders()["X-Wallet-Session"]) {
    return false;
  }
  return !options?.local?.canPay;
}

async function ensureWalletForPay() {
  if (typeof tajCoinAuth === "undefined") {
    return { ok: false, error: "Module wallet non chargé — rechargez la page" };
  }
  if (!getEthereumProvider?.()) {
    return {
      ok: false,
      error:
        "Depuis le LAN, MetaMask est requis — le wallet nœud (tajpanel) n'est pas accessible. Connectez-vous sur /wallet/login.",
    };
  }

  tajCoinAuth.restoreSession();
  if (tajCoinAuth.sessionId) {
    try {
      await tajCoinAuth.getWalletData();
      return { ok: true };
    } catch (err) {
      tajCoinAuth.clearSession();
      if (!String(err?.message || "").includes("Session")) {
        return { ok: false, error: err.message || "Session wallet invalide" };
      }
    }
  }

  try {
    await tajCoinAuth.login();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || "Connexion MetaMask annulée" };
  }
}

async function postTajPay(apiBase, sessionId) {
  return fetch(`${apiBase}/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...walletPayHeaders(),
    },
    body: JSON.stringify({ sessionId, source: "auto" }),
  });
}

async function payTajSession({ apiBase, sessionId, payOptions, onStatus }) {
  if (onStatus) onStatus("Préparation du paiement…");

  const options = payOptions || (await loadTajPayOptions(apiBase));

  if (needsWalletSession(options)) {
    if (onStatus) onStatus("Connexion MetaMask…");
    const wallet = await ensureWalletForPay();
    if (!wallet.ok) {
      return {
        res: { ok: false, status: 401 },
        data: { error: wallet.error },
        payOptions: options,
      };
    }
  }

  if (onStatus) onStatus("Envoi Tajcoin en cours…");

  let res = await postTajPay(apiBase, sessionId);
  let data = await res.json();

  if (!res.ok && (res.status === 401 || res.status === 402) && !walletPayHeaders()["X-Wallet-Session"]) {
    if (onStatus) onStatus("Connexion MetaMask…");
    const wallet = await ensureWalletForPay();
    if (wallet.ok) {
      if (onStatus) onStatus("Envoi Tajcoin en cours…");
      res = await postTajPay(apiBase, sessionId);
      data = await res.json();
    } else if (!data.error) {
      data = { error: wallet.error };
    }
  }

  return { res, data, payOptions: options };
}

function createTajPoll(checkFn, intervalMs = 4000) {
  let timer = null;
  return {
    start() {
      this.stop();
      timer = setInterval(async () => {
        const done = await checkFn();
        if (done) this.stop();
      }, intervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

if (typeof window !== "undefined") {
  window.isLocalhostClient = isLocalhostClient;
  window.ensureWalletForPay = ensureWalletForPay;
}
