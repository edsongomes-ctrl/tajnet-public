"use strict";

const SESSION_SERVICES = {
  guard: {
    apiBase: "/api/guard",
    isDone: (data) => Boolean(data.unlocked || data.session?.status === "unlocked"),
    getStoredSession: () => (typeof getGuardSession === "function" ? getGuardSession() : null),
    saveStoredSession: (session) => {
      if (typeof saveGuardSession === "function") saveGuardSession(session);
    },
    clearStoredSession: () => {
      if (typeof clearGuardSession === "function") clearGuardSession();
    },
    checkRequest: (sessionId) => ({
      url: "/api/guard/check",
      method: "POST",
      body: { sessionId },
    }),
    isCheckDone: (data) => Boolean(data.unlocked || data.session?.status === "unlocked"),
  },
  pin: {
    apiBase: "/api/pin-service",
    isDone: (data) => Boolean(data.completed || data.session?.status === "completed"),
    getStoredSession: () => null,
    saveStoredSession: () => {},
    clearStoredSession: () => {},
    checkRequest: (sessionId) => ({
      url: `/api/pin-service/session/${sessionId}/check`,
      method: "POST",
      body: {},
    }),
    isCheckDone: (data) => Boolean(data.completed || data.session?.status === "completed"),
  },
  stake: {
    apiBase: "/api/content-staking",
    isDone: (data) => Boolean(data.completed || data.session?.status === "completed"),
    getStoredSession: () => null,
    saveStoredSession: () => {},
    clearStoredSession: () => {},
    checkRequest: (sessionId) => ({
      url: `/api/content-staking/session/${sessionId}/check`,
      method: "POST",
      body: {},
    }),
    isCheckDone: (data) => Boolean(data.completed || data.session?.status === "completed"),
  },
  cvAccess: {
    apiBase: "/api/super-cv/access",
    isDone: (data) => Boolean(data.completed || data.session?.status === "completed"),
    getStoredSession: () => null,
    saveStoredSession: () => {},
    clearStoredSession: () => {},
    checkRequest: (sessionId) => ({
      url: `/api/super-cv/access/session/${sessionId}/check`,
      method: "POST",
      body: {},
    }),
    isCheckDone: (data) => Boolean(data.completed || data.session?.status === "completed"),
  },
  branPublish: {
    apiBase: "/api/bran-web/publish",
    isDone: (data) => Boolean(data.completed || data.session?.status === "completed"),
    getStoredSession: () => null,
    saveStoredSession: () => {},
    clearStoredSession: () => {},
    checkRequest: (sessionId) => ({
      url: `/api/bran-web/publish/session/${sessionId}/check`,
      method: "POST",
      body: {},
    }),
    isCheckDone: (data) => Boolean(data.completed || data.session?.status === "completed"),
  },
};

const servicePolls = {};
const payOptionsCache = {};

async function loadServicePayOptions(serviceId) {
  const svc = SESSION_SERVICES[serviceId];
  if (!svc) return null;
  const data = await loadTajPayOptions(svc.apiBase);
  if (data) payOptionsCache[serviceId] = data;
  return data;
}

function formatPayHint(payOptions) {
  if (!payOptions?.local && !payOptions?.wallet) return "";
  const local = payOptions.local;
  const wallet = payOptions.wallet;
  if (wallet?.connected) {
    let hint = `<br><span class="tagline">Wallet personnel — ${Number(wallet.balance).toFixed(4)} TAJ`;
    if (wallet.canPay) hint += " — paiement possible";
    else hint += " — solde insuffisant";
    if (wallet.address) hint += ` · <code>${wallet.address}</code>`;
    hint += "</span>";
    return hint;
  }
  if (local?.requiresMetamask && !local.canPay) {
    const zoneHint = typeof isWanClient === "function" && isWanClient()
      ? "Depuis Internet"
      : "Depuis le LAN";
    return `<br><span class="tagline">${zoneHint} : connectez MetaMask sur <a href="/wallet/login.html">/wallet/login</a> — le wallet nœud n'est pas exposé</span>`;
  }
  if (local?.canPay) {
    return `<br><span class="tagline">Compte nœud « ${local.account} » : ${Number(local.balance).toFixed(4)} TAJ — paiement direct (localhost)</span>`;
  }
  return "";
}

function stopServicePoll(serviceId) {
  if (servicePolls[serviceId]) {
    servicePolls[serviceId].stop();
    delete servicePolls[serviceId];
  }
}

function startServicePoll(serviceId, checkFn) {
  stopServicePoll(serviceId);
  servicePolls[serviceId] = createTajPoll(checkFn);
  servicePolls[serviceId].start();
}

async function checkSessionService(serviceId, sessionId, { silent = false, saveSession } = {}) {
  const svc = SESSION_SERVICES[serviceId];
  if (!svc || !sessionId) return { ok: false, done: false };

  try {
    const req = svc.checkRequest(sessionId);
    const res = await fetch(req.url, {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await res.json();
    if (!res.ok) {
      if (!silent && data.error) return { ok: false, done: false, error: data.error };
      if (res.status === 404) svc.clearStoredSession();
      return { ok: false, done: false };
    }

    if (typeof saveSession === "function") {
      saveSession(data.session);
    } else if (data.session) {
      svc.saveStoredSession(data.session);
    }

    const done = svc.isCheckDone(data);
    if (done) stopServicePoll(serviceId);
    return { ok: true, done, data };
  } catch {
    if (!silent) return { ok: false, done: false, error: "Erreur réseau" };
    return { ok: false, done: false };
  }
}

async function paySessionService(serviceId, options = {}) {
  const svc = SESSION_SERVICES[serviceId];
  if (!svc) return { ok: false, error: "Service inconnu" };

  const {
    session: sessionOverride,
    ensureSession,
    onStatus,
    saveSession,
    getSessionAfterEnsure,
    onComplete,
  } = options;

  let session = sessionOverride || svc.getStoredSession();

  if (!session || session.status !== "pending") {
    if (!ensureSession) {
      return { ok: false, error: "Aucune session en attente" };
    }
    const ensured = await ensureSession();
    if (!ensured) return { ok: false, error: "Impossible de créer la session" };
    session = getSessionAfterEnsure?.() || sessionOverride || svc.getStoredSession();
  }

  if (!session?.sessionId) {
    return { ok: false, error: "Session invalide" };
  }

  const payOptions = payOptionsCache[serviceId] || (await loadServicePayOptions(serviceId));

  const { res, data } = await payTajSession({
    apiBase: svc.apiBase,
    sessionId: session.sessionId,
    payOptions,
    onStatus,
  });

  if (!res.ok) {
    return {
      ok: false,
      error: data.error || "Paiement impossible",
      data,
      session,
    };
  }

  if (typeof saveSession === "function") {
    saveSession(data.session);
  } else if (data.session) {
    svc.saveStoredSession(data.session);
  }

  if (svc.isDone(data)) {
    stopServicePoll(serviceId);
    return { ok: true, done: true, data, session: data.session };
  }

  startServicePoll(serviceId, async () => {
    const result = await checkSessionService(serviceId, data.session.sessionId, {
      silent: true,
      saveSession,
    });
    if (result.done && typeof onComplete === "function") {
      onComplete(result.data);
    }
    return result.done;
  });

  return { ok: true, done: false, pending: true, data, session: data.session };
}

async function fundAccountService(account, amount, { onStatus } = {}) {
  if (onStatus) onStatus("Préparation du paiement…");

  const options = await loadTajPayOptions("/api/payments");

  if (needsWalletSession(options)) {
    if (onStatus) onStatus("Connexion MetaMask…");
    const wallet = await ensureWalletForPay();
    if (!wallet.ok) {
      return {
        ok: false,
        res: { status: 401 },
        data: { error: wallet.error || metamaskRequiredMessage() },
      };
    }
  }

  if (onStatus) onStatus("Envoi Tajcoin en cours…");

  let res = await fetch("/api/payments/fund", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...walletPayHeaders(),
    },
    body: JSON.stringify({ account, amount }),
  });
  let data = await res.json();

  if (!res.ok && (res.status === 401 || res.status === 402) && !walletPayHeaders()["X-Wallet-Session"]) {
    if (onStatus) onStatus("Connexion MetaMask…");
    const wallet = await ensureWalletForPay();
    if (wallet.ok) {
      if (onStatus) onStatus("Envoi Tajcoin en cours…");
      res = await fetch("/api/payments/fund", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...walletPayHeaders(),
        },
        body: JSON.stringify({ account, amount }),
      });
      data = await res.json();
    } else if (!data.error) {
      data = { error: wallet.error || metamaskRequiredMessage() };
    }
  }

  return { ok: res.ok, data, res };
}

if (typeof window !== "undefined") {
  window.payOptionsCache = payOptionsCache;
}
