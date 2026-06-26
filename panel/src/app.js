let matomoEmbedVisible = false;
let matomoDashboardUrl = "";
let matomoEmbedUrl = "";
let activePinSession = null;
let activeStakeSession = null;
let announceAccountStatus = null;
let ipfsClientGatewayBase = null;
let panelRequestZone = null;

async function parseApiResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(
      response.ok
        ? "Réponse serveur invalide"
        : `HTTP ${response.status}${snippet ? ` — ${snippet}` : ""}`
    );
  }
}

function formatFetchError(err) {
  const msg = String(err?.message || err || "");
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    const httpsUrl = `${window.location.protocol === "https:" ? window.location.origin : `https://${window.location.hostname}`}/panel/`;
    if (window.location.protocol === "http:" && typeof isWanClient === "function" && isWanClient()) {
      return `Connexion bloquée en HTTP depuis Internet — ouvrez ${httpsUrl} et acceptez le certificat.`;
    }
    return `Connexion impossible (${msg}) — vérifiez HTTPS, le certificat auto-signé, puis réessayez.`;
  }
  return msg || "Erreur réseau.";
}

async function ensureGuardReadyForUpload(statusEl) {
  const refreshed = await refreshGuardSessionFromServer();
  if (refreshed.ok && refreshed.unlocked) {
    return true;
  }
  if (refreshed.reason === "network" && isGuardSessionUnlocked()) {
    return true;
  }
  if (refreshed.reason === "expired" || !isGuardSessionUnlocked()) {
    showGuardBlocked(statusEl);
    await payGuardInline();
    return isGuardSessionUnlocked();
  }
  showGuardBlocked(statusEl);
  await payGuardInline();
  return isGuardSessionUnlocked();
}

function isPanelOperatorLocal() {
  return panelRequestZone === "localhost";
}

function isPanelWan() {
  return panelRequestZone === "wan";
}

function pinnedOnNodeLabel() {
  return isPanelOperatorLocal() ? "Épinglé local" : "Épinglé sur ce nœud";
}

function ipfsContentUrl(cid) {
  if (!cid) return null;
  const base = ipfsClientGatewayBase || `${window.location.origin}/ipfs`;
  return `${base.replace(/\/$/, "")}/${cid}`;
}

async function refreshStatus() {
  const statusEl = document.getElementById("status");
  const guardEl = document.getElementById("guard");
  const pluginsEl = document.getElementById("plugins");

  try {
    const [statusRes, pluginsRes] = await Promise.all([
      fetch("/api/status"),
      fetch("/api/plugins"),
    ]);

    const data = await statusRes.json();
    panelRequestZone = data.requestZone || null;
    const { plugins } = await pluginsRes.json();

    const ipfs = data.ipfs || {};
    ipfsClientGatewayBase = data.ipfsClient?.gatewayBase || `${window.location.origin}/ipfs`;
    const tajcoin = data.tajcoin || {};
    const lines = [];

    lines.push(
      `<div class="terminal-line"><span class="terminal-prompt">→</span><span>Moteur <span class="status-active">${data.engine || "online"}</span> — état <span class="${data.status === "online" ? "status-active" : "status-offline"}">${data.status}</span>${data.version ? ` — v${data.version}` : ""}</span></div>`
    );

    if (ipfs.online) {
      const nodeShort = (ipfs.nodeId || data.nodeId || "").slice(0, 16);
      lines.push(
        `<div class="terminal-line"><span class="terminal-prompt">→</span><span>IPFS <span class="status-active">online</span> — ${nodeShort}…</span></div>`
      );
    } else {
      lines.push(
        `<div class="terminal-line"><span class="terminal-prompt">→</span><span>IPFS <span class="status-offline">offline</span>${ipfs.error ? ` — ${ipfs.error}` : ""}</span></div>`
      );
    }

    if (tajcoin.online) {
      lines.push(
        `<div class="terminal-line"><span class="terminal-prompt">→</span><span>Tajcoin <span class="status-active">${tajcoin.blocks} blocs</span> — ${tajcoin.connections || 0} peers</span></div>`
      );
    } else {
      lines.push(
        `<div class="terminal-line"><span class="terminal-prompt">→</span><span>Tajcoin <span class="status-offline">offline</span>${tajcoin.error ? ` — ${tajcoin.error}` : ""}</span></div>`
      );
    }

    if (data.tajnodeMode === "vps" || data.publicPanel) {
      lines.push(
        `<div class="terminal-line"><span class="terminal-prompt">→</span><span>Mode <span class="status-active">VPS</span> — panel public WAN, MetaMask requis à distance</span></div>`
      );
    }

    if (data.requestZone) {
      const zoneLabel =
        data.requestZone === "localhost"
          ? "localhost (opérateur)"
          : data.requestZone === "lan"
            ? "LAN"
            : "Internet";
      lines.push(
        `<div class="terminal-line"><span class="terminal-prompt">→</span><span>Zone d'accès : <span class="status-active">${zoneLabel}</span></span></div>`
      );
    }

    statusEl.innerHTML = lines.join("");

    updateNavStatus(data.status);
    updateStatsBar(data);

    if (data.guard && guardEl) {
      const icon = data.guard.locked ? "🔒" : "🔓";
      guardEl.innerHTML =
        `${icon} ${data.guard.message}` +
        (data.guard.bypass ? ' <span class="status-active">(bypass)</span>' : "") +
        (data.guard.price ? ` — <strong>${data.guard.price} TAJ</strong>` : "");
      updateGuardPanel(data.guard);
      updateGuardPublishHint(data.guard);
      loadGuardPayOptions();
    }

    if (data.discover) {
      updateDiscoverPanel(data.discover);
    }

    if (data.pinService) {
      updatePinServicePanel(data.pinService);
      loadPinPayOptions();
    }
    if (data.pinRewards) {
      updatePinRewardsPanel(data.pinRewards);
    }
    if (data.contentStaking) {
      updateContentStakingPanel(data.contentStaking, data.contentMetrics);
    }
    if (data.announce) {
      announceAccountStatus = data.announce;
      updateAnnouncePanel(data.announce);
    }

    if (data.superCv) {
      updateSuperCvPanel(data.superCv);
    }
    if (data.branWeb) {
      updateBranWebPanel(data.branWeb, data);
    }

    updateMatomo(data.matomo);
    initMatomoTracking(data.matomo);

    if (pluginsEl && Array.isArray(plugins)) {
      pluginsEl.innerHTML = plugins
        .map(
          (p) =>
            `<li class="${p.active ? "" : "inactive"}">${p.name} v${p.version}` +
            `${p.active ? " ✓" : ""}</li>`
        )
        .join("");
    }

    updateOperatorPanel(data);
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML =
        '<div class="terminal-line"><span class="terminal-prompt">!</span><span class="status-offline">Erreur de connexion au moteur</span></div>';
    }
    updateNavStatus("offline");
    console.error("refreshStatus:", err);
  }
}

function updateNavStatus(status) {
  const dot = document.getElementById("navStatusDot");
  const text = document.getElementById("navStatusText");
  if (!dot || !text) return;

  dot.classList.remove("online", "degraded", "offline");
  if (status === "online") {
    dot.classList.add("online");
    text.textContent = "SYS.ONLINE";
  } else if (status === "degraded") {
    dot.classList.add("degraded");
    text.textContent = "SYS.DEGRADED";
  } else {
    dot.classList.add("offline");
    text.textContent = "SYS.OFFLINE";
  }
}

function updateStatsBar(data) {
  const ipfs = data.ipfs || {};
  const tajcoin = data.tajcoin || {};
  const discover = data.discover || {};
  const superCv = data.superCv || {};

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  set("statEngine", data.status === "online" ? "ON" : data.status === "degraded" ? "DEG" : "OFF");
  set("statIpfs", ipfs.online ? "OK" : "—");
  set("statTajcoin", tajcoin.online ? String(tajcoin.blocks || "OK") : "—");
  set("statDiscover", discover.enabled ? String(discover.entryCount || 0) : "OFF");
  set("statCv", String(superCv.totalSearchable ?? superCv.localCount ?? 0));
}

function formatPublicationStatus({ cid, announce, gatewayUrl = null }) {
  const lines = [];

  if (cid) {
    const gw = gatewayUrl
      ? ` — <a href="${gatewayUrl}" target="_blank" rel="noopener noreferrer">gateway ↗</a>`
      : "";
    lines.push(
      `<div class="pub-status-row">` +
        `<span class="status-badge badge-ipfs">IPFS disponible</span>` +
        `<div class="pub-status-body"><code>${cid}</code>${gw}</div>` +
        `</div>`
    );
  }

  if (!announce || announce.status === "skipped") {
    if (cid) {
      lines.push(
        `<div class="pub-status-row">` +
          `<span class="status-badge badge-pending">Blockchain</span> ` +
          `<span class="pub-status-hint">non diffusée${announce?.reason ? ` (${announce.reason})` : ""}</span>` +
          `</div>`
      );
    }
  } else if (announce.status === "broadcast") {
    lines.push(
      `<div class="pub-status-row">` +
        `<span class="status-badge badge-chain">Blockchain diffusée</span> ` +
        `tx <code>${announce.txid?.slice(0, 16)}…</code>` +
        (announce.metadataCid ? ` — meta <code>${announce.metadataCid}</code>` : "") +
        `</div>` +
        `<div class="pub-status-row pub-status-hint">Confirmation réseau : ~2–40 min selon activité Tajcoin</div>`
    );
  } else if (announce.status === "failed") {
    const err = announce.error || "erreur inconnue";
    const needsFunds = /tajannounce|UTXO|insuffisant/i.test(err);
    const addr = announceAccountStatus?.address;
    const fundHint =
      needsFunds
        ? `<div class="pub-status-row pub-status-hint">` +
          `<button type="button" class="btn-primary btn-sm" onclick="fundAnnounceInline()">Alimenter tajannounce (1 TAJ)</button> ` +
          (addr
            ? `<code id="announceFundAddr">${addr}</code> ` +
              `<button type="button" class="btn-inline" onclick="copyAnnounceAddress()">Copier</button>`
            : "") +
          `</div>`
        : "";
    lines.push(
      `<div class="pub-status-row">` +
        `<span class="status-badge badge-error">Blockchain échouée</span> ` +
        `${err}` +
        `</div>` +
        fundHint
    );
  }

  if (!lines.length) return "";
  return `<div class="pub-status">${lines.join("")}</div>`;
}

function formatAnnounce(announce, context = {}) {
  if (!announce && !context.cid) return "";
  return formatPublicationStatus({
    cid: context.cid || announce?.contentCid || null,
    gatewayUrl: context.gatewayUrl || null,
    announce,
  });
}

async function uploadToIpfs() {
  const fileInput = document.getElementById("ipfsFile");
  const statusEl = document.getElementById("ipfsUploadStatus");
  const resultEl = document.getElementById("ipfsUploadResult");
  const wrap = document.getElementById("ipfsWrap")?.checked;

  if (
    window.location.protocol === "http:" &&
    typeof isWanClient === "function" &&
    isWanClient()
  ) {
    const httpsUrl = `https://${window.location.hostname}/panel/`;
    statusEl.textContent = `Depuis Internet, utilisez HTTPS : ${httpsUrl}`;
    resultEl.classList.add("hidden");
    return;
  }

  if (!(await ensureGuardReadyForUpload(statusEl))) {
    resultEl.classList.add("hidden");
    return;
  }

  if (!fileInput.files[0]) {
    statusEl.textContent = "Sélectionnez un fichier.";
    resultEl.classList.add("hidden");
    return;
  }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  if (wrap) {
    formData.append("wrap", "true");
  }

  statusEl.textContent = "Upload IPFS en cours…";
  resultEl.classList.add("hidden");

  try {
    const response = await fetch(`${window.location.origin}/api/ipfs/upload`, {
      method: "POST",
      headers: guardSessionHeaders(),
      body: formData,
      credentials: "same-origin",
    });
    const result = await parseApiResponse(response);

    if (!response.ok) {
      if (response.status === 402) {
        clearGuardSession();
        showGuardBlocked(statusEl, result);
        await payGuardInline();
        if (await ensureGuardReadyForUpload(statusEl)) {
          return uploadToIpfs();
        }
        return;
      }
      statusEl.textContent = result.message || result.detail || result.error || "Échec upload IPFS";
      return;
    }

    statusEl.textContent = "Fichier épinglé sur IPFS.";
    resultEl.classList.remove("hidden");
    resultEl.innerHTML =
      `<div class="ipfs-result-cid">` +
      `<span class="ipfs-result-label">CID</span>` +
      `<code>${result.cid}</code>` +
      `</div>` +
      `<div class="ipfs-result-links">` +
      `<a href="${result.gatewayUrl}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-sm">Voir le contenu ↗</a>` +
      `<a href="${result.dwebUrl}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-sm">Gateway public ↗</a>` +
      `</div>` +
      (result.name || result.size
        ? `<p class="ipfs-result-meta">${result.name || "Fichier"}${result.size ? ` — ${formatBytes(result.size)}` : ""}</p>`
        : "") +
      formatAnnounce(result.announce, { cid: result.cid, gatewayUrl: result.gatewayUrl });
  } catch (err) {
    statusEl.textContent = formatFetchError(err);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

async function uploadCV() {
  const fileInput = document.getElementById("cvFile");
  const uploadStatus = document.getElementById("uploadStatus");

  if (!isGuardSessionUnlocked()) {
    showGuardBlocked(uploadStatus);
    await payGuardInline();
    if (!isGuardSessionUnlocked()) return;
  }

  if (!fileInput.files[0]) {
    uploadStatus.textContent = "Sélectionnez un fichier.";
    return;
  }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  uploadStatus.textContent = "Traitement en cours par le moteur...";

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      headers: guardSessionHeaders(),
      body: formData,
    });
    const result = await parseApiResponse(response);

    if (!response.ok) {
      if (response.status === 402) {
        clearGuardSession();
        showGuardBlocked(uploadStatus, result);
        await payGuardInline();
        if (isGuardSessionUnlocked()) {
          return uploadCV();
        }
        return;
      }
      uploadStatus.textContent = result.message || result.detail || result.error || "Échec upload";
      return;
    }

    let msg = `Succès : ${result.message}`;
    if (result.data?.format) {
      msg += ` (${result.data.format.toUpperCase()}${result.data.pages ? `, ${result.data.pages} p.` : ""})`;
    }
    if (result.data?.skills?.length) {
      msg += ` — ${result.data.skills.slice(0, 5).join(", ")}`;
    }
    const cvCid = result.data?.ipfs?.cid;
    const cvGatewayUrl = result.gatewayUrl || result.data?.ipfs?.gatewayUrl || ipfsContentUrl(cvCid);
    uploadStatus.innerHTML =
      msg +
      formatAnnounce(result.announce || result.data?.announce, {
        cid: cvCid,
        gatewayUrl: cvGatewayUrl,
      });
  } catch (err) {
    uploadStatus.textContent = err?.message || "Erreur réseau.";
  }
}

function goToGuard() {
  switchCategory("security");
  document.getElementById("guardPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateGuardPublishHint(guard) {
  const el = document.getElementById("guardPublishHint");
  if (!el) return;

  if (guard?.bypass || isGuardSessionUnlocked()) {
    el.innerHTML = `<span class="status-active">Guard OK — vous pouvez uploader.</span>`;
    return;
  }

  const session = getGuardSession();
  if (session?.status === "pending") {
    el.innerHTML =
      `<span class="status-offline">Paiement Guard en attente (${session.amount || guard?.price || 1} TAJ)</span> — ` +
      `<button type="button" class="btn-primary btn-sm" onclick="payGuardInline()">Payer maintenant</button> ` +
      `<button type="button" class="btn-inline" onclick="checkGuardSession()">Vérifier</button>`;
    return;
  }

  el.innerHTML =
    `<span class="status-offline">Porte verrouillée</span> — tarif <strong>${guard?.price ?? 1} TAJ</strong> · ` +
    `<button type="button" class="btn-primary btn-sm" onclick="payGuardInline()">Payer et déverrouiller</button>`;
}

function showGuardBlocked(el, result) {
  if (!el) return;
  const price = result?.price ?? result?.guard?.price ?? 1;
  el.innerHTML =
    `<span class="status-offline">${guardRequiredMessage()}</span> ` +
    `<button type="button" class="btn-primary btn-sm" onclick="payGuardInline()">Payer ${price} TAJ</button>`;
  if (result?.guard) {
    updateGuardPanel(result.guard);
    updateGuardPublishHint(result.guard);
  }
}

function updateGuardPanel(guard) {
  const infoEl = document.getElementById("guardInfo");
  const paymentEl = document.getElementById("guardPayment");
  const checkBtn = document.getElementById("guardCheckBtn");
  const payBtn = document.getElementById("guardPayBtn");
  const stored = getGuardSession();

  if (!infoEl) return;

  if (guard.bypass) {
    infoEl.innerHTML = '<span class="status-active">Accès libre — GUARD_BYPASS actif</span>';
    paymentEl.classList.add("hidden");
    checkBtn.disabled = true;
    if (payBtn) payBtn.disabled = true;
    updateGuardPublishHint(guard);
    return;
  }

  const session = getGuardSession();

  if (session?.status === "unlocked") {
    infoEl.innerHTML =
      `<span class="status-active">Porte ouverte</span> — session <code title="${session.sessionId}">${session.sessionId.slice(0, 12)}…</code>` +
      (session.unlockedUntil
        ? `<br><span class="tagline">Valide jusqu'à ${new Date(session.unlockedUntil).toLocaleTimeString()}</span>`
        : "");
    paymentEl.classList.add("hidden");
    checkBtn.disabled = true;
    if (payBtn) payBtn.disabled = true;
    updateGuardPublishHint(guard);
    return;
  }

  if (session?.status === "pending") {
    infoEl.innerHTML =
      `<span class="status-offline">En attente de paiement</span> — <strong>${session.amount} TAJ</strong>` +
      formatPayHint(window.payOptionsCache?.guard);
    paymentEl.classList.remove("hidden");
    paymentEl.innerHTML =
      `<p class="tagline">Paiement intégré — aucun changement de page requis.</p>` +
      `<p>Adresse manuelle : <code id="guardPayAddr">${session.paymentAddress}</code> ` +
      `<button type="button" class="btn-inline" onclick="copyGuardAddress()">Copier</button></p>` +
      `<p class="tagline">Reçu : ${session.pendingAmount || 0} / ${session.amount} TAJ` +
      (session.confirmations ? ` — ${session.confirmations} conf.` : "") +
      `</p>`;
    checkBtn.disabled = false;
    if (payBtn) {
      payBtn.disabled = false;
      payBtn.textContent = `Payer ${session.amount} TAJ`;
    }
    updateGuardPublishHint(guard);
    return;
  }

  infoEl.innerHTML =
    guard.locked
      ? `Porte verrouillée — tarif <strong>${guard.price} TAJ</strong> (${guard.minConfirmations} confirmation(s))`
      : `<span class="status-active">${guard.message}</span>`;
  paymentEl.classList.add("hidden");
  checkBtn.disabled = !stored;
  if (payBtn) {
    payBtn.disabled = false;
    payBtn.textContent = `Payer ${guard.price ?? 1} TAJ`;
  }
  updateGuardPublishHint(guard);
}

function formatGuardPayHint() {
  return formatPayHint(window.payOptionsCache?.guard);
}

async function loadGuardPayOptions() {
  return loadServicePayOptions("guard");
}

async function payGuardInline() {
  const infoEl = document.getElementById("guardInfo");
  const payBtn = document.getElementById("guardPayBtn");

  if (isGuardSessionUnlocked()) {
    if (infoEl) infoEl.innerHTML = '<span class="status-active">Porte déjà ouverte</span>';
    return;
  }

  if (payBtn) payBtn.disabled = true;

  const result = await paySessionService("guard", {
    ensureSession: () => openGuardSession(true),
    getSessionAfterEnsure: () => getGuardSession(),
    onStatus: (msg) => {
      if (infoEl) infoEl.textContent = msg;
    },
    onComplete: (data) => {
      updateGuardPanel(data.guard);
      if (infoEl) infoEl.innerHTML = '<span class="status-active">Paiement confirmé — porte ouverte !</span>';
    },
  });

  if (!result.ok) {
    if (infoEl) {
      const details = result.data || {};
      let extra = "";
      if (details.source === "wallet" && details.address) {
        extra = `<br><span class="tagline">Wallet personnel connecté — solde ${Number(details.balance || 0).toFixed(4)} TAJ, requis ${details.required ?? result.session?.amount} TAJ · envoyez des TAJ à <code>${details.address}</code></span>`;
      } else if (details.balance != null) {
        extra = `<br><span class="tagline">Solde : ${Number(details.balance).toFixed(4)} TAJ — requis : ${details.required ?? result.session?.amount} TAJ</span>`;
      }
      infoEl.innerHTML =
        `<span class="status-offline">${result.error || "Paiement impossible"}</span>` +
        extra +
        `<br><span class="tagline"><a href="/wallet/login.html">Wallet Tajcoin</a> · ou payez manuellement ci-dessous</span>`;
    }
    updateGuardPanel(result.data?.guard || { locked: true, price: result.session?.amount ?? 1 });
    if (payBtn) payBtn.disabled = false;
    return;
  }

  updateGuardPanel(result.data.guard);

  if (result.done) {
    if (infoEl) {
      infoEl.innerHTML =
        `<span class="status-active">Paiement confirmé — porte ouverte !</span>` +
        `<br><span class="tagline">TX : <code>${result.data.txid}</code> · via ${result.data.paidVia === "wallet" ? "wallet" : "nœud local"}</span>`;
    }
    return;
  }

  if (infoEl) {
    infoEl.innerHTML =
      `<span class="status-offline">TX envoyée — attente de confirmation blockchain…</span>` +
      `<br><span class="tagline">TX : <code>${result.data.txid}</code></span>`;
  }
}

async function openGuardSession(silent = false) {
  const infoEl = document.getElementById("guardInfo");
  if (!silent && infoEl) infoEl.textContent = "Création de session…";

  try {
    const res = await fetch("/api/guard/session", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      if (infoEl) infoEl.textContent = data.error || "Impossible de créer la session";
      return false;
    }
    saveGuardSession(data.session);
    await loadGuardPayOptions();
    updateGuardPanel(data.guard);
    if (!silent && data.session.status === "unlocked") {
      infoEl.innerHTML = '<span class="status-active">Session bypass — accès immédiat</span>';
    }
    return true;
  } catch {
    if (infoEl) infoEl.textContent = "Erreur réseau Guard";
    return false;
  }
}

async function checkGuardSession(silent = false) {
  const sessionId = getGuardSessionId();
  if (!sessionId) return false;

  const infoEl = document.getElementById("guardInfo");
  if (!silent && infoEl) infoEl.textContent = "Vérification blockchain…";

  const result = await checkSessionService("guard", sessionId, { silent });
  if (!result.ok) {
    if (!silent && infoEl) infoEl.textContent = result.error || "Session invalide";
    return false;
  }

  updateGuardPanel(result.data.guard);
  if (result.done && !silent && infoEl) {
    infoEl.innerHTML = '<span class="status-active">Paiement confirmé — porte ouverte !</span>';
  }
  return result.done;
}

async function copyGuardAddress() {
  const el = document.getElementById("guardPayAddr");
  if (!el) return;
  await navigator.clipboard.writeText(el.textContent);
}

async function restoreGuardSession() {
  const refreshed = await refreshGuardSessionFromServer();
  if (refreshed.ok) {
    try {
      const res = await fetch(`${window.location.origin}/api/guard/status`);
      const data = await res.json();
      if (data.guard) updateGuardPanel(data.guard);
    } catch {
      /* ignore status refresh */
    }
    return;
  }
  if (refreshed.reason === "expired") {
    updateGuardPanel({ locked: true, price: 1 });
  }
}

const CATEGORY_HASH = {
  guard: "security",
  security: "security",
  publish: "publish",
  ipfs: "publish",
  matomo: "publish",
  discover: "network",
  network: "network",
  cv: "addons",
  "super-cv": "addons",
  talents: "addons",
  addons: "addons",
  "bran-web": "addons",
  overview: "overview",
};

const CATEGORY_TO_HASH = {
  overview: "",
  security: "guard",
  publish: "publish",
  network: "discover",
  addons: "addons",
};

const ADDON_SECTION_IDS = {
  cv: "addon-super-cv",
  "super-cv": "addon-super-cv",
  talents: "addon-super-cv",
  "bran-web": "addon-bran-web",
};

function scrollToAddonSection(catId) {
  if (catId !== "addons") return;
  const raw = window.location.hash.replace(/^#/, "");
  const sectionId = ADDON_SECTION_IDS[raw];
  if (!sectionId) return;
  requestAnimationFrame(() => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function switchCategory(catId) {
  document.querySelectorAll(".category-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.category === catId);
  });
  document.querySelectorAll(".category-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cat === catId);
  });

  const hash = CATEGORY_TO_HASH[catId];
  const url = hash ? `#${hash}` : window.location.pathname;
  if (window.location.hash !== (hash ? `#${hash}` : "")) {
    history.replaceState(null, "", url);
  }

  if (window.matchMedia("(max-width: 767px)").matches) {
    const content = document.querySelector(".panel-content");
    if (content) {
      window.scrollTo({ top: content.offsetTop - 56, behavior: "smooth" });
    }
  }

  scrollToAddonSection(catId);
}

function categoryFromHash() {
  const raw = (window.location.hash || "").replace(/^#/, "").toLowerCase();
  return CATEGORY_HASH[raw] || "overview";
}

function initCategoryNav() {
  document.querySelectorAll(".category-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchCategory(btn.dataset.cat));
  });

  switchCategory(categoryFromHash());

  window.addEventListener("hashchange", () => {
    switchCategory(categoryFromHash());
  });
}

function updateBranWebPanel(branWeb, statusData) {
  const statusEl = document.getElementById("branWebStatus");
  const hintEl = document.getElementById("branWebOperatorHint");
  const genBtn = document.getElementById("branWebGenerateBtn");
  if (!statusEl || !branWeb) return;

  const price = branWeb.publish?.price ?? 2;
  const state = branWeb.generated
    ? `<span class="status-active">Archive démo disponible</span>`
    : `<span class="status-offline">Archive démo non générée</span>`;
  statusEl.innerHTML =
    `${state} — éditeur gratuit · publication <strong>${price} TAJ</strong> (MetaMask)` +
    ` · <a href="/bran-web/edit.html">/bran-web/edit.html</a>`;

  const operator = !isPanelWan() && statusData?.nodeConfigAllowed !== false;
  if (hintEl) hintEl.classList.toggle("hidden", operator);
  if (genBtn) genBtn.classList.toggle("hidden", !operator);
}

async function generateBranWeb() {
  const statusEl = document.getElementById("branWebActionStatus");
  if (statusEl) statusEl.textContent = "Génération en cours…";
  try {
    const res = await fetch("/api/bran-web/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) {
      if (statusEl) statusEl.textContent = data.error || "Échec génération";
      return;
    }
    if (statusEl) statusEl.textContent = data.stdout || "Structure Bran Web régénérée.";
    if (data.branWeb) updateBranWebPanel(data.branWeb, {});
    loadStatus();
  } catch {
    if (statusEl) statusEl.textContent = "Erreur réseau";
  }
}

async function checkBranWeb() {
  const statusEl = document.getElementById("branWebActionStatus");
  if (statusEl) statusEl.textContent = "Validation workflow…";
  try {
    const res = await fetch("/api/bran-web/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ check: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (statusEl) statusEl.textContent = data.error || "Workflow invalide";
      return;
    }
    if (statusEl) statusEl.textContent = data.stdout || "Workflow valide.";
  } catch {
    if (statusEl) statusEl.textContent = "Erreur réseau";
  }
}

function updateSuperCvPanel(superCv) {
  const statusEl = document.getElementById("superCvStatus");
  if (!statusEl || !superCv) return;
  statusEl.innerHTML =
    `<span class="status-active">${superCv.totalSearchable || 0} profil(s)</span>` +
    ` — local ${superCv.localCount || 0}, Discover ${superCv.discoverCvCount || 0}`;
}

async function searchSuperCv() {
  const listEl = document.getElementById("cvResults");
  const q = document.getElementById("cvQuery")?.value || "";
  const skills = document.getElementById("cvSkills")?.value || "";
  const params = new URLSearchParams({ limit: "20" });
  if (q) params.set("q", q);
  if (skills) params.set("skills", skills);

  if (!listEl) return;
  listEl.innerHTML = `<li class="entry-meta">Recherche…</li>`;

  try {
    const res = await fetch(`/api/super-cv/search?${params}`);
    const data = await res.json();
    if (!res.ok) {
      listEl.innerHTML = `<li>Erreur recherche</li>`;
      return;
    }

    if (!data.results?.length) {
      listEl.innerHTML = `<li class="entry-meta">Aucun CV correspondant.</li>`;
      return;
    }

    listEl.innerHTML = data.results
      .map((entry) => {
        const skillsHtml = (entry.matchedSkills?.length ? entry.matchedSkills : entry.skills || [])
          .slice(0, 8)
          .map((s) => `<code>${s}</code>`)
          .join(" ");
        const ficheHref =
          entry.ficheUrl ||
          `/cv?id=${encodeURIComponent(entry.id || entry.txid || "")}`;
        const link = entry.hasContent
          ? `<a href="${ficheHref}">Voir la fiche candidat →</a>`
          : `<a href="${ficheHref}">Voir la fiche (compétences) →</a>`;
        return (
          `<li>` +
          `<div class="entry-title">${entry.title || entry.id} — score ${entry.score}</div>` +
          `<div class="entry-meta">${skillsHtml || "—"}</div>` +
          `<div class="entry-meta">${entry.source || "local"}${entry.txid ? ` — tx ${entry.txid.slice(0, 12)}…` : ""}</div>` +
          (link ? `<div class="entry-meta">${link}</div>` : "") +
          `</li>`
        );
      })
      .join("");
  } catch {
    listEl.innerHTML = `<li>Erreur réseau</li>`;
  }
}

function updateDiscoverPanel(discover) {
  const statusEl = document.getElementById("discoverStatus");
  if (!statusEl || !discover) return;

  const operatorBlock = document.getElementById("discoverOperatorBlock");
  const wanHint = document.getElementById("discoverWanHint");
  const wan = isPanelWan();
  if (operatorBlock) operatorBlock.classList.toggle("hidden", wan);
  if (wanHint) wanHint.classList.toggle("hidden", !wan);

  const state = discover.enabled
    ? `<span class="status-active">Discover actif</span>`
    : `<span class="status-offline">Discover inactif</span>`;

  statusEl.innerHTML =
    `${state} — ${discover.entryCount || 0} entrée(s)` +
    (discover.lastScannedHeight != null ? ` — bloc ${discover.lastScannedHeight}` : "") +
    (discover.scanning ? " — scan en cours…" : "") +
    (discover.lastScanError ? `<br><span class="status-offline">${discover.lastScanError}</span>` : "");

  const profile = discover.profile || {};
  const publicEl = document.getElementById("discoverPublic");
  const nameEl = document.getElementById("discoverNodeName");
  const endpointEl = document.getElementById("discoverEndpoint");
  const pinPriceEl = document.getElementById("discoverPinPrice");
  const uptimeEl = document.getElementById("discoverUptime");
  if (publicEl && document.activeElement !== publicEl) {
    publicEl.checked = Boolean(profile.public);
  }
  if (nameEl && document.activeElement !== nameEl && profile.name) {
    nameEl.value = profile.name;
  }
  if (endpointEl && document.activeElement !== endpointEl && profile.endpoint) {
    endpointEl.value = profile.endpoint;
  }
  if (pinPriceEl && document.activeElement !== pinPriceEl) {
    pinPriceEl.value = profile.pinPriceTaj ?? 0.5;
  }
  if (uptimeEl && document.activeElement !== uptimeEl) {
    uptimeEl.value = profile.uptimeScore ?? 100;
  }
}

async function enableDiscover() {
  await fetch("/api/discover/enable", { method: "POST" });
  refreshStatus();
  loadDiscoverEntries();
}

async function disableDiscover() {
  await fetch("/api/discover/disable", { method: "POST" });
  refreshStatus();
}

async function scanDiscover() {
  const statusEl = document.getElementById("discoverStatus");
  if (statusEl) statusEl.textContent = "Scan blockchain en cours…";
  try {
    const res = await fetch("/api/discover/scan", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      if (statusEl) statusEl.textContent = data.error || "Scan échoué";
      return;
    }
    updateDiscoverPanel(data.discover);
    loadDiscoverEntries();
  } catch {
    if (statusEl) statusEl.textContent = "Erreur réseau Discover";
  }
}

async function saveDiscoverProfile() {
  const body = {
    public: document.getElementById("discoverPublic")?.checked || false,
    name: document.getElementById("discoverNodeName")?.value?.trim() || "TajNode",
    endpoint: document.getElementById("discoverEndpoint")?.value?.trim() || "",
    pinPriceTaj: Number(document.getElementById("discoverPinPrice")?.value || 0),
    uptimeScore: Number(document.getElementById("discoverUptime")?.value || 100),
  };
  await fetch("/api/discover/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  refreshStatus();
  loadDiscoverNodes();
}

function updateOperatorPanel(data) {
  const block = document.getElementById("operatorLocalhostBlock");
  if (!block) return;

  const isLocalhost = data.requestZone === "localhost";
  block.classList.toggle("hidden", !isLocalhost);
  if (!isLocalhost) return;

  const profile = data.landing || {};
  const setVal = (id, value) => {
    const el = document.getElementById(id);
    if (el && value != null) el.value = value;
  };

  setVal("landingNodeName", profile.nodeName);
  setVal("landingTagline", profile.tagline);
  setVal("landingHeroTitle", profile.heroTitle);
  setVal("landingHeroLead", profile.heroLead);
  setVal("landingPrimaryLabel", profile.primaryCtaLabel);
  setVal("landingPrimaryUrl", profile.primaryCtaUrl);
  setVal("landingSecondaryLabel", profile.secondaryCtaLabel);
  setVal("landingSecondaryUrl", profile.secondaryCtaUrl);
  setVal("landingFooterText", profile.footerText);
  setVal("landingContactEmail", profile.contactEmail);

  const showDeploy = document.getElementById("landingShowDeploy");
  if (showDeploy) showDeploy.checked = profile.showDeploymentSection !== false;

  const walletStatus = document.getElementById("walletDatStatus");
  const wallet = data.walletDat || {};
  if (walletStatus) {
    if (wallet.available) {
      const sizeKb = ((wallet.sizeBytes || 0) / 1024).toFixed(1);
      walletStatus.textContent = `wallet.dat trouvé — ${sizeKb} Ko — ${wallet.path || ""}`;
    } else {
      walletStatus.textContent = wallet.reason || "wallet.dat introuvable sur ce nœud";
    }
  }

  loadTajcoinNodes();
}

function renderTajcoinNodeList(data) {
  const listEl = document.getElementById("tajcoinNodeList");
  const statusEl = document.getElementById("tajcoinNodesStatus");
  if (!listEl) return;

  const conf = data?.tajcoinConf || {};
  const live = data?.live || {};
  const peers = Array.isArray(live.peers) ? live.peers : [];
  const peerHosts = new Set(
    peers.map((peer) => String(peer.addr || "").split(":")[0]).filter(Boolean)
  );

  if (statusEl) {
    if (!conf.available) {
      statusEl.textContent = conf.reason || "tajcoin.conf introuvable";
    } else {
      const conn = live.connections != null ? live.connections : "—";
      statusEl.textContent = `${conf.count || 0} addnode(s) dans ${conf.path || "tajcoin.conf"} — ${conn} connexion(s) P2P active(s)`;
    }
  }

  const nodes = conf.addnodes || data?.addnodes || [];
  if (!nodes.length) {
    listEl.innerHTML = '<li class="operator-status">Aucun addnode configuré</li>';
    return;
  }

  listEl.innerHTML = nodes
    .map((node) => {
      const host = node.split(":")[0];
      const liveTag = peerHosts.has(host) ? ' <span class="node-live">● connecté</span>' : "";
      return `<li><span>addnode=${node}${liveTag}</span><button type="button" class="btn-secondary btn-sm" onclick="removeTajcoinNode('${encodeURIComponent(node)}')">Retirer</button></li>`;
    })
    .join("");
}

async function loadTajcoinNodes() {
  const block = document.getElementById("operatorLocalhostBlock");
  if (!block || block.classList.contains("hidden")) return;

  try {
    const res = await fetch("/api/tajcoin/nodes");
    const data = await res.json();
    if (!res.ok) {
      renderTajcoinNodeList({ tajcoinConf: { available: false, reason: data.error } });
      return;
    }
    renderTajcoinNodeList({
      tajcoinConf: {
        available: true,
        path: data.path,
        count: data.addnodes?.length || 0,
        addnodes: data.addnodes || [],
      },
      live: data.live || {},
      addnodes: data.addnodes || [],
    });
  } catch {
    renderTajcoinNodeList({ tajcoinConf: { available: false, reason: "Erreur réseau" } });
  }
}

async function addTajcoinNode() {
  const input = document.getElementById("tajcoinNodeInput");
  const statusEl = document.getElementById("tajcoinNodesActionStatus");
  const connectNow = document.getElementById("tajcoinNodeConnectNow")?.checked !== false;
  const node = input?.value?.trim();
  if (!node) {
    if (statusEl) statusEl.textContent = "Saisissez une adresse IP ou hostname";
    return;
  }

  try {
    const res = await fetch("/api/tajcoin/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node, connectNow }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (statusEl) statusEl.textContent = data.error || "Ajout échoué";
      return;
    }
    if (input) input.value = "";
    if (statusEl) statusEl.textContent = data.message || "Nœud ajouté";
    loadTajcoinNodes();
    refreshStatus();
  } catch {
    if (statusEl) statusEl.textContent = "Erreur réseau";
  }
}

async function importTajcoinNodesBulk() {
  const textarea = document.getElementById("tajcoinNodesBulk");
  const statusEl = document.getElementById("tajcoinNodesActionStatus");
  const connectNow = document.getElementById("tajcoinNodeConnectNow")?.checked !== false;
  const raw = textarea?.value?.trim();
  if (!raw) {
    if (statusEl) statusEl.textContent = "Collez au moins une adresse";
    return;
  }

  const nodes = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  try {
    const res = await fetch("/api/tajcoin/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes, connectNow }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (statusEl) statusEl.textContent = data.error || "Import échoué";
      return;
    }
    if (textarea) textarea.value = "";
    if (statusEl) statusEl.textContent = data.message || "Liste importée";
    loadTajcoinNodes();
    refreshStatus();
  } catch {
    if (statusEl) statusEl.textContent = "Erreur réseau";
  }
}

async function removeTajcoinNode(encodedNode) {
  const statusEl = document.getElementById("tajcoinNodesActionStatus");
  const node = decodeURIComponent(encodedNode || "");
  if (!node) return;

  try {
    const res = await fetch(`/api/tajcoin/nodes/${encodeURIComponent(node)}?disconnect=1`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) {
      if (statusEl) statusEl.textContent = data.error || "Suppression échouée";
      return;
    }
    if (statusEl) statusEl.textContent = data.message || "Nœud retiré";
    loadTajcoinNodes();
    refreshStatus();
  } catch {
    if (statusEl) statusEl.textContent = "Erreur réseau";
  }
}

async function saveLandingProfile() {
  const statusEl = document.getElementById("landingSaveStatus");
  const profile = {
    nodeName: document.getElementById("landingNodeName")?.value?.trim(),
    tagline: document.getElementById("landingTagline")?.value?.trim(),
    heroTitle: document.getElementById("landingHeroTitle")?.value,
    heroLead: document.getElementById("landingHeroLead")?.value?.trim(),
    primaryCtaLabel: document.getElementById("landingPrimaryLabel")?.value?.trim(),
    primaryCtaUrl: document.getElementById("landingPrimaryUrl")?.value?.trim(),
    secondaryCtaLabel: document.getElementById("landingSecondaryLabel")?.value?.trim(),
    secondaryCtaUrl: document.getElementById("landingSecondaryUrl")?.value?.trim(),
    footerText: document.getElementById("landingFooterText")?.value?.trim(),
    contactEmail: document.getElementById("landingContactEmail")?.value?.trim(),
    showDeploymentSection: document.getElementById("landingShowDeploy")?.checked !== false,
  };

  try {
    const res = await fetch("/api/landing/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (statusEl) statusEl.textContent = data.error || "Enregistrement échoué";
      return;
    }
    if (statusEl) statusEl.textContent = "Page d'accueil enregistrée";
    refreshStatus();
  } catch {
    if (statusEl) statusEl.textContent = "Erreur réseau";
  }
}

async function exportWalletDat() {
  const statusEl = document.getElementById("walletDatActionStatus");
  try {
    const res = await fetch("/api/tajcoin/wallet/export");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (statusEl) statusEl.textContent = data.error || "Export impossible";
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "wallet.dat";
    link.click();
    URL.revokeObjectURL(url);
    if (statusEl) statusEl.textContent = "wallet.dat téléchargé";
  } catch {
    if (statusEl) statusEl.textContent = "Erreur réseau";
  }
}

async function importWalletDat(input) {
  const statusEl = document.getElementById("walletDatActionStatus");
  const file = input?.files?.[0];
  if (!file) return;

  const form = new FormData();
  form.append("wallet", file);

  try {
    const res = await fetch("/api/tajcoin/wallet/import", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      if (statusEl) {
        statusEl.textContent = data.hint ? `${data.error} — ${data.hint}` : data.error || "Import échoué";
      }
      return;
    }
    if (statusEl) statusEl.textContent = data.message || "Import réussi — redémarrez tajcoind";
    refreshStatus();
  } catch {
    if (statusEl) statusEl.textContent = "Erreur réseau";
  } finally {
    input.value = "";
  }
}

function protocolLabel(protocol) {
  const labels = {
    "tajnet-binary": "TajNet",
    "tajnetv1": "TAJNETv1",
    "tajcoin-cid": "Tajcoin",
    "legacy-pipe": "Futuremen v0",
  };
  return labels[protocol] || protocol || "?";
}

function poolClaimedByUser(entry, address) {
  if (!address || !entry?.contentPool?.claims?.length) return false;
  const key = String(address).toLowerCase();
  return entry.contentPool.claims.some((c) => String(c.claimAddress || "").toLowerCase() === key);
}

function formatPoolBadge(entry) {
  const pool = entry.contentPool;
  if (!pool || Number(pool.totalContributed) <= 0) return "";
  const per = Number(pool.rewardPerClaim || 0.5);
  return (
    `<span class="status-badge badge-chain">Cagnotte ${Number(pool.totalContributed).toFixed(2)} TAJ` +
    ` (${Number(pool.availableTaj).toFixed(2)} dispo · ${per} TAJ/événement · vous ${Number(pool.readerSharePerClaim ?? per * 0.25).toFixed(2)} TAJ)</span> `
    + (Number(pool.investorReserve) > 0
      ? `<span class="status-badge badge-pending">Réserve investisseur ${Number(pool.investorReserve).toFixed(2)} TAJ</span> `
      : "")
  );
}

function formatViewCountBadge(entry) {
  const views = Number(entry.contentMetrics?.visits ?? 0);
  if (!entry.contentCid) return "";
  return `<span class="status-badge badge-ipfs">${views} vue${views !== 1 ? "s" : ""}</span> `;
}

function formatMetricsBadge(entry) {
  const m = entry.contentMetrics;
  if (!m) return "";
  return `<span class="status-badge">Score ${m.score}${m.boostScore != null ? ` · boost ${Number(m.boostScore).toFixed(2)}` : ""}</span> `;
}

function entryRewardMeta(entry) {
  const pool = entry.contentPool;
  const per = Number(pool?.rewardPerClaim || 0.5);
  const readerPer = Number(pool?.readerSharePerClaim ?? per * 0.25);
  const available = Number(pool?.availableTaj || 0);
  const canClaim = pool && available + 1e-8 >= per;
  const myAddress = typeof tajCoinAuth !== "undefined" ? tajCoinAuth.tajcoinAddress : null;
  const alreadyClaimed = poolClaimedByUser(entry, myAddress);
  const pinned = entry.claimEligibility?.pinnedOnNode ?? entry.localPinned;
  const viewed = entry.claimEligibility?.viewedContent;
  const hasPool = pool && Number(pool.totalContributed) > 0;

  let state = null;
  let score = 0;
  if (pinned && canClaim && !alreadyClaimed) {
    state = viewed ? "ready" : "view-first";
    score = viewed ? 1000 : 900;
  } else if (alreadyClaimed && hasPool) {
    state = "claimed";
    score = 100;
  } else if (canClaim && !pinned) {
    state = "awaiting-pin";
    score = 800;
  } else if (hasPool) {
    state = "pool";
    score = 700;
  } else if (Number(entry.pinRewardTaj) > 0) {
    state = "publisher";
    score = 600;
  }

  return {
    state,
    score,
    per,
    readerPer,
    available,
    canClaim,
    pinned,
    viewed,
    alreadyClaimed,
    hasPool,
    isOpportunity: score >= 700,
  };
}

function sortDiscoverEntries(entries) {
  return [...entries].sort((a, b) => {
    const sa = entryRewardMeta(a).score;
    const sb = entryRewardMeta(b).score;
    if (sb !== sa) return sb - sa;
    const ba = Number(a.contentMetrics?.boostScore ?? 0);
    const bb = Number(b.contentMetrics?.boostScore ?? 0);
    if (bb !== ba) return bb - ba;
    return (b.blockHeight || 0) - (a.blockHeight || 0);
  });
}

function renderDiscoverRewardHero(entry, meta) {
  if (!meta.state || meta.state === "publisher") return "";

  const txid = entry.txid;
  const amount = meta.readerPer.toFixed(2).replace(".", ",");
  const total = meta.per.toFixed(1).replace(".", ",");

  if (meta.state === "ready") {
    return (
      `<div class="entry-reward-hero">` +
      `<div class="entry-reward-badge"><span class="entry-reward-amount">${amount}</span><span class="entry-reward-currency">TAJ</span></div>` +
      `<div class="entry-reward-text">` +
      `<p class="entry-reward-title">Prêt à réclamer</p>` +
      `<p class="entry-reward-hint">Cliquez pour recevoir ${amount} TAJ (répartition sur ${total} TAJ).</p>` +
      `</div>` +
      `<div class="entry-reward-cta">` +
      `<button type="button" class="btn-reward-primary" onclick="claimDiscoverReward('${txid}')">Réclamer ${amount} TAJ →</button>` +
      `</div></div>`
    );
  }

  if (meta.state === "view-first") {
    return (
      `<div class="entry-reward-hero">` +
      `<div class="entry-reward-badge"><span class="entry-reward-amount">${amount}</span><span class="entry-reward-currency">TAJ</span></div>` +
      `<div class="entry-reward-text">` +
      `<p class="entry-reward-title">Récompense disponible</p>` +
      `<p class="entry-reward-hint">Ouvrez le contenu, puis réclamez ${amount} TAJ.</p>` +
      `</div>` +
      `<div class="entry-reward-cta">` +
      `<button type="button" class="btn-reward-primary" onclick="viewContentForReward('${txid}')">Consulter & gagner ${amount} TAJ →</button>` +
      `</div></div>`
    );
  }

  if (meta.state === "awaiting-pin") {
    return (
      `<div class="entry-reward-hero">` +
      `<div class="entry-reward-badge"><span class="entry-reward-amount">${amount}</span><span class="entry-reward-currency">TAJ</span></div>` +
      `<div class="entry-reward-text">` +
      `<p class="entry-reward-title">Cagnotte en attente</p>` +
      `<p class="entry-reward-hint">${meta.available.toFixed(2)} TAJ en cagnotte — épinglage requis.</p>` +
      `</div></div>`
    );
  }

  if (meta.state === "claimed") {
    return (
      `<div class="entry-reward-hero">` +
      `<div class="entry-reward-badge"><span class="entry-reward-amount">✓</span><span class="entry-reward-currency">TAJ</span></div>` +
      `<div class="entry-reward-text">` +
      `<p class="entry-reward-title">Réclamation effectuée</p>` +
      `<p class="entry-reward-hint">Vous avez déjà touché votre part pour ce contenu.</p>` +
      `</div></div>`
    );
  }

  if (meta.state === "pool") {
    return (
      `<div class="entry-reward-hero">` +
      `<div class="entry-reward-badge"><span class="entry-reward-amount">${meta.available.toFixed(1).replace(".", ",")}</span><span class="entry-reward-currency">TAJ</span></div>` +
      `<div class="entry-reward-text">` +
      `<p class="entry-reward-title">Cagnotte active</p>` +
      `<p class="entry-reward-hint">${meta.available.toFixed(2)} TAJ restants dans la cagnotte (${meta.per} TAJ max par réclamation).</p>` +
      `</div></div>`
    );
  }

  return "";
}

function discoverEntrySecondaryActions(entry, meta) {
  if (!entry.contentCid && !(isCvDiscoverEntry(entry) && entry.cvHasIpfsContent)) return "";
  const operatorLocal = isPanelOperatorLocal();
  let html = `<details class="entry-more-actions"><summary>Autres actions</summary><div class="discover-entry-actions">`;

  if (operatorLocal && entry.contentCid && !entry.localPinned) {
    html += `<button type="button" class="btn-secondary btn-sm" onclick="pinDiscoverEntry('${entry.txid}')">Épingler local (opérateur)</button>`;
  }

  if (entry.contentCid) {
    html += `<button type="button" class="btn-secondary btn-sm" onclick="requestPinService('${entry.txid}')">Soutenir (don pinning)</button>`;
    html += `<button type="button" class="btn-secondary btn-sm" onclick="stakeDiscoverContent('${entry.txid}', '${entry.contentCid}')">Contribuer (stake)</button>`;
  }

  if (meta.state === "ready") {
    html += `<button type="button" class="btn-secondary btn-sm" onclick="viewContentForReward('${entry.txid}')">Revoir le contenu ↗</button>`;
  }

  html += `</div></details>`;
  return html;
}

function isCvDiscoverEntry(entry) {
  return entry?.type === "cv";
}

function cvDiscoverFicheUrl(entry) {
  return entry.cvFicheUrl || (entry.cvProfileId ? `/cv?id=${encodeURIComponent(entry.cvProfileId)}` : null);
}

function renderDiscoverEntry(entry) {
  const meta = entryRewardMeta(entry);
  const title =
    entry.title ||
    entry.metadata?.title ||
    entry.contentCid ||
    entry.metadataCid ||
    entry.txid;
  const isCv = isCvDiscoverEntry(entry);
  const cvFiche = isCv ? cvDiscoverFicheUrl(entry) : null;
  const ficheUrl = isCv
    ? cvFiche
    : entry.txid
      ? `/view?txid=${encodeURIComponent(entry.txid)}`
      : entry.metadataCid
        ? `/view?meta=${encodeURIComponent(entry.metadataCid)}`
        : null;
  const cvLocked = isCv && entry.cvHasIpfsContent && !entry.cvContentUnlocked;
  const linkParts = [];
  if (ficheUrl) {
    linkParts.push(
      `<a href="${ficheUrl}" target="_blank" rel="noopener noreferrer">${isCv ? "Fiche candidat ↗" : "Fiche ↗"}</a>`
    );
  }
  if (cvLocked) {
    const price = Number(entry.cvAccessPrice ?? 1);
    linkParts.push(
      `<a href="${cvFiche || ficheUrl}">Débloquer CV — ${price.toFixed(2)} TAJ</a>`
    );
  } else if (entry.contentUrl) {
    linkParts.push(`<a href="${entry.contentUrl}" target="_blank" rel="noopener noreferrer">Contenu IPFS ↗</a>`);
  }
  if (!cvLocked && entry.publicContentUrl && entry.publicContentUrl !== entry.contentUrl) {
    linkParts.push(`<a href="${entry.publicContentUrl}" target="_blank" rel="noopener noreferrer">Gateway public ↗</a>`);
  }
  const gateway = linkParts.join(" · ");
  const titleHtml = ficheUrl
    ? `<a href="${ficheUrl}" target="_blank" rel="noopener noreferrer">${title}</a>`
    : title;
  const metaHint =
    entry.metadataStatus === "unavailable"
      ? `<span class="status-offline"> — métadonnées IPFS indisponibles</span>`
      : entry.metadataStatus === "pending"
        ? `<span class="status-offline"> — métadonnées en cours…</span>`
        : "";
  const proto = protocolLabel(entry.protocol);
  const source = entry.source ? ` — ${entry.source}` : "";
  const reward =
    entry.pinRewardTaj > 0
      ? `<span class="status-badge badge-chain">${entry.pinRewardTaj} TAJ cagnotte créateur</span> `
      : "";
  const poolBadge = meta.isOpportunity ? "" : formatPoolBadge(entry);
  const paid =
    entry.localPin?.claim?.status === "paid" || meta.alreadyClaimed
      ? `<span class="status-badge badge-ipfs">Récompense payée</span> `
      : "";
  const pinned = entry.localPinned
    ? `<span class="status-badge badge-ipfs">${pinnedOnNodeLabel()}</span> `
    : "";

  const liClass = [
    meta.isOpportunity ? "discover-entry--reward" : "",
    meta.state === "ready" || meta.state === "view-first" ? "discover-entry--claimable" : "",
    meta.state === "claimed" ? "discover-entry--claimed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    `<li${liClass ? ` class="${liClass}"` : ""}>` +
    renderDiscoverRewardHero(entry, meta) +
    `<div class="entry-title">${entry.type || "?"} — ${titleHtml}</div>` +
    `<div class="entry-meta">` +
    `<span class="protocol-badge">${proto}</span>` +
    reward +
    formatViewCountBadge(entry) +
    (meta.isOpportunity ? formatPoolBadge(entry) : poolBadge) +
    formatMetricsBadge(entry) +
    paid +
    pinned +
    `tx <code>${entry.txid?.slice(0, 16)}…</code>` +
    (entry.blockHeight != null ? ` — bloc ${entry.blockHeight}` : "") +
    source +
    metaHint +
    `</div>` +
    (gateway ? `<div class="entry-meta">${gateway}</div>` : "") +
    discoverEntrySecondaryActions(entry, meta) +
    `</li>`
  );
}

function updateDiscoverOpportunitiesIntro(entries) {
  const introEl = document.getElementById("discoverRewardsIntro");
  if (!introEl) return;

  const claimable = entries.filter((e) => {
    const m = entryRewardMeta(e);
    return m.state === "ready" || m.state === "view-first";
  });
  const withPool = entries.filter((e) => entryRewardMeta(e).isOpportunity);

  if (!withPool.length) {
    introEl.classList.add("hidden");
    introEl.innerHTML = "";
    return;
  }

  introEl.classList.remove("hidden");
  if (claimable.length) {
    introEl.innerHTML =
      `<strong>${claimable.length} récompense${claimable.length > 1 ? "s" : ""}</strong> disponible${claimable.length > 1 ? "s" : ""} — utilisez le bouton vert.`;
  } else {
    introEl.innerHTML =
      `<strong>${withPool.length} cagnotte${withPool.length > 1 ? "s" : ""}</strong> active${withPool.length > 1 ? "s" : ""}.`;
  }
}

async function loadDiscoverEntries() {
  const listEl = document.getElementById("discoverEntries");
  const oppEl = document.getElementById("discoverOpportunities");
  if (!listEl) return;

  if (typeof tajCoinAuth !== "undefined") {
    tajCoinAuth.restoreSession();
  }

  const q = document.getElementById("discoverQuery")?.value || "";
  const type = document.getElementById("discoverType")?.value || "";
  const protocol = document.getElementById("discoverProtocol")?.value || "";
  const params = new URLSearchParams({ limit: "30" });
  if (q) params.set("q", q);
  if (type) params.set("type", type);
  if (protocol) params.set("protocol", protocol);

  try {
    const res = await fetch(`/api/discover/entries?${params}`, {
      headers: walletPayHeaders(),
    });
    const data = await res.json();
    if (!res.ok) {
      listEl.innerHTML = `<li>Erreur chargement index</li>`;
      if (oppEl) oppEl.innerHTML = "";
      return;
    }

    if (!data.entries?.length) {
      listEl.innerHTML = `<li class="entry-meta">Aucune annonce indexée pour l'instant.</li>`;
      if (oppEl) oppEl.innerHTML = "";
      updateDiscoverOpportunitiesIntro([]);
      return;
    }

    const sorted = sortDiscoverEntries(data.entries);
    const opportunities = sorted.filter((e) => entryRewardMeta(e).isOpportunity);
    const others = sorted.filter((e) => !entryRewardMeta(e).isOpportunity);

    updateDiscoverOpportunitiesIntro(sorted);

    if (oppEl) {
      oppEl.innerHTML = opportunities.length
        ? opportunities.map(renderDiscoverEntry).join("")
        : `<li class="entry-meta">Aucune cagnotte active pour l'instant.</li>`;
    }

    if (others.length) {
      listEl.innerHTML =
        (opportunities.length ? `<li class="discover-section-head">Autres annonces</li>` : "") +
        others.map(renderDiscoverEntry).join("");
    } else {
      listEl.innerHTML = `<li class="entry-meta">Toutes les annonces ont une cagnotte — voir ci-dessus.</li>`;
    }
  } catch {
    listEl.innerHTML = `<li>Erreur réseau</li>`;
    if (oppEl) oppEl.innerHTML = "";
  }
}

function updateAnnouncePanel(announce) {
  const el = document.getElementById("announceStatus");
  if (!el || !announce) return;

  if (!announce.enabled) {
    el.innerHTML = `<span class="status-offline">Annonces désactivées</span> — ANNOUNCE_ENABLED=false`;
    return;
  }

  if (announce.error) {
    el.innerHTML =
      `<span class="status-offline">Compte ${announce.account || "tajannounce"} — erreur</span> — ${announce.error}`;
    return;
  }

  const balance = Number(announce.balanceTaj || 0);
  const funded = balance > 0 || (announce.utxoCount || 0) > 0;
  el.innerHTML =
    (funded
      ? `<span class="status-active">Compte ${announce.account} prêt</span>`
      : `<span class="status-offline">Compte ${announce.account} vide</span>`) +
    ` — <strong>${balance.toFixed(4)} TAJ</strong> (${announce.utxoCount || 0} UTXO)` +
    `<br><button type="button" class="btn-primary btn-sm" onclick="fundAnnounceInline()">Alimenter (1 TAJ)</button>` +
    (announce.address
      ? ` <code id="announcePayAddr">${announce.address}</code> ` +
        `<button type="button" class="btn-inline" onclick="copyAnnounceAddress()">Copier</button>`
      : "") +
    `<br><span class="pub-status-hint">Paiement intégré — alimente le compte pour les annonces on-chain (OP_RETURN).</span>`;
}

async function fundAnnounceInline(amount = 1) {
  const el = document.getElementById("announceStatus");
  if (el) el.textContent = "Alimentation en cours…";

  const result = await fundAccountService("tajannounce", amount, {
    onStatus: (msg) => {
      if (el) el.textContent = msg;
    },
  });

  if (!result.ok) {
    if (el) {
      el.innerHTML =
        `<span class="status-offline">${result.data?.error || "Alimentation impossible"}</span>` +
        (result.data?.balance != null
          ? `<br><span class="tagline">Solde nœud : ${Number(result.data.balance).toFixed(4)} TAJ</span>`
          : "");
    }
    return;
  }

  const announce = result.data.announce || announceAccountStatus;
  if (announce) {
    announceAccountStatus = announce;
    updateAnnouncePanel(announce);
  } else {
    refreshStatus();
  }

  if (el && !announce) {
    el.innerHTML =
      `<span class="status-active">Compte alimenté</span> — TX <code>${result.data.txid}</code> · ${result.data.amount} TAJ`;
  }
}

function copyAnnounceAddress() {
  const el = document.getElementById("announcePayAddr") || document.getElementById("announceFundAddr");
  if (el?.textContent) {
    navigator.clipboard?.writeText(el.textContent.trim());
  }
}

function updatePinServicePanel(pinService) {
  const statusEl = document.getElementById("pinServiceStatus");
  if (!statusEl || !pinService) return;
  statusEl.innerHTML =
    (pinService.enabled
      ? `<span class="status-active">Service actif</span>`
      : `<span class="status-offline">Service inactif</span>`) +
    ` — tarif local <strong>${pinService.price ?? "?"} TAJ</strong>/pin` +
    (pinService.activeSessions ? ` — ${pinService.activeSessions} session(s) en attente` : "") +
    (isPanelOperatorLocal()
      ? ""
      : `<br><span class="tagline">Visiteur distant — <strong>Soutenir (don pinning)</strong> pour épingler et alimenter la cagnotte, ou <strong>Contribuer (stake)</strong> pour investir.</span>`);
}

function updateContentStakingPanel(staking, metrics) {
  const el = document.getElementById("contentStakingStatus");
  if (!el || !staking) return;
  el.innerHTML =
    `<span class="status-active">Staking contenu</span>` +
    ` — min <strong>${staking.minStakeTaj} TAJ</strong>` +
    ` — APY base <strong>${Number(staking.baseApyPercent).toFixed(1)} %</strong>` +
    (metrics?.totalVisits ? ` — <strong>${metrics.totalVisits}</strong> vues comptabilisées` : "") +
    (staking.totalStakedActive ? ` — <strong>${staking.totalStakedActive.toFixed(2)} TAJ</strong> stakés actifs` : "");
}

function showStakePayment(session, statusMessage = null) {
  const paymentEl = document.getElementById("stakePayment");
  if (!paymentEl || !session) return;
  activeStakeSession = session;
  paymentEl.classList.remove("hidden");
  const preview = session.preview || {};
  paymentEl.innerHTML =
    `<p><strong>Stake contributeur</strong> — <strong>${session.amount} TAJ</strong> · ${session.periodLabel || session.periodId}</p>` +
    (statusMessage ? `<p class="tagline">${statusMessage}</p>` : `<p class="tagline">Mode investisseur — part des réclamations futures (25 %) selon votre mise.</p>`) +
    (preview.totalPayout
      ? `<p class="tagline">Estimation échéance : <strong>${Number(preview.totalPayout).toFixed(4)} TAJ</strong> (dont ${Number(preview.yieldTaj || 0).toFixed(4)} rendement · APY ~${preview.apy}%)</p>`
      : "") +
    `<p class="tagline">CID : <code>${session.contentCid}</code></p>` +
    `<div class="guard-actions">` +
    `<button type="button" class="btn-primary btn-sm" id="stakePayBtn" onclick="payStakeInline()">Staker ${session.amount} TAJ</button>` +
    `<button type="button" class="btn-secondary btn-sm" onclick="checkStakeSession()">Vérifier</button>` +
    `</div>`;
  paymentEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function stakeDiscoverContent(txid, contentCid) {
  const amountRaw = window.prompt("Montant TAJ à staker (minimum 1) :", "5");
  if (amountRaw == null) return;
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount < 1) {
    alert("Montant invalide (minimum 1 TAJ)");
    return;
  }
  const periodId = window.prompt("Durée : 1m, 3m, 6m ou 12m", "1m") || "1m";

  const wallet = await ensureWalletForPay();
  if (!wallet.ok) {
    alert(wallet.error || "MetaMask requis");
    return;
  }

  try {
    const res = await fetch("/api/content-staking/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...walletPayHeaders() },
      body: JSON.stringify({ contentCid, amount, periodId, claimAddress: tajCoinAuth.tajcoinAddress }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Session staking impossible");
      return;
    }
    await loadServicePayOptions("stake");
    showStakePayment(data.session);
    await payStakeInline();
  } catch {
    alert("Erreur réseau");
  }
}

async function payStakeInline() {
  if (!activeStakeSession?.sessionId) return;
  const payBtn = document.getElementById("stakePayBtn");
  if (payBtn) payBtn.disabled = true;
  showStakePayment(activeStakeSession, "Préparation du paiement…");

  const result = await paySessionService("stake", {
    session: activeStakeSession,
    saveSession: (session) => {
      activeStakeSession = session;
    },
    onStatus: (msg) => showStakePayment(activeStakeSession, msg),
    onComplete: () => {
      showStakePayment(activeStakeSession, '<span class="status-active">Stake actif — rendement calculé à l\'échéance</span>');
      loadDiscoverEntries();
      refreshStatus();
    },
  });

  if (!result.ok) {
    showStakePayment(activeStakeSession, result.error || "Paiement impossible");
    if (payBtn) payBtn.disabled = false;
    return;
  }

  activeStakeSession = result.session;
  if (result.done) {
    showStakePayment(activeStakeSession, `<span class="status-active">Stake confirmé</span> · TX <code>${result.data.txid}</code>`);
    loadDiscoverEntries();
    refreshStatus();
    return;
  }
  showStakePayment(activeStakeSession, `TX envoyée — attente confirmation… · <code>${result.data.txid}</code>`);
}

async function checkStakeSession(silent = false) {
  if (!activeStakeSession?.sessionId) return false;
  const result = await checkSessionService("stake", activeStakeSession.sessionId, {
    silent,
    saveSession: (session) => {
      activeStakeSession = session;
    },
  });
  if (result.done) {
    showStakePayment(result.data.session, '<span class="status-active">Stake actif</span>');
    loadDiscoverEntries();
    refreshStatus();
  }
  return result.done;
}

function updatePinRewardsPanel(pinRewards) {
  const el = document.getElementById("pinRewardsStatus");
  if (!el || !pinRewards) return;
  const pool = pinRewards.contentPool;
  const poolLine = pool
    ? `<br><span class="tagline">Cagnottes — <strong>${pool.availableTaj.toFixed(2)} TAJ</strong> disponibles` +
      ` (${pool.totalContributed.toFixed(2)} TAJ versés, ${pool.claimCount} réclamation(s))` +
      ` — <strong>${pool.rewardPerClaim ?? 0.5} TAJ</strong> / événement (créateur · lecteur · hébergeur · investisseur)` +
      (Number(pool.investorReserve) > 0
        ? ` — réserve investisseur <strong>${Number(pool.investorReserve).toFixed(2)} TAJ</strong>`
        : "") +
      `</span>`
    : "";
  el.innerHTML =
    (pinRewards.autoPay
      ? `<span class="status-active">Paiement auto cagnotte → lecteur</span>`
      : `<span class="status-offline">Paiement auto désactivé</span>`) +
    ` — escrow <code>${pinRewards.escrowAccount || "tajescrow"}</code>` +
    (pinRewards.funded ? ` — ${pinRewards.funded} escrow(s) financé(s)` : "") +
    poolLine;
}

function formatPinPayHint() {
  return formatPayHint(window.payOptionsCache?.pin);
}

async function loadPinPayOptions() {
  return loadServicePayOptions("pin");
}

function showPinPayment(session, statusMessage = null) {
  const paymentEl = document.getElementById("pinPayment");
  if (!paymentEl || !session) return;
  activePinSession = session;
  paymentEl.classList.remove("hidden");

  paymentEl.innerHTML =
    `<p><strong>Don pinning</strong> — <strong>${session.amount} TAJ</strong></p>` +
    (statusMessage
      ? `<p class="tagline">${statusMessage}</p>`
      : `<p class="tagline">Vous apportez le revenu : la cagnotte finance créateur, lecteurs, hébergeur et investisseurs.</p>`) +
    formatPinPayHint() +
    `<p class="tagline">CID : <code>${session.contentCid}</code></p>` +
    `<p class="tagline">Reçu : ${session.pendingAmount || 0} / ${session.amount} TAJ` +
    (session.confirmations ? ` — ${session.confirmations} conf.` : "") +
    `</p>` +
    `<div class="guard-actions">` +
    `<button type="button" class="btn-primary btn-sm" id="pinPayBtn" onclick="payPinInline()">Payer ${session.amount} TAJ</button>` +
    `<button type="button" class="btn-secondary btn-sm" onclick="checkPinSession()">Vérifier</button>` +
    `</div>` +
    `<p class="tagline">Manuel : <code id="pinPayAddr">${session.paymentAddress}</code> ` +
    `<button type="button" class="btn-inline" onclick="copyPinAddress()">Copier</button></p>`;

  paymentEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  paymentEl.classList.add("pin-payment-highlight");
  setTimeout(() => paymentEl.classList.remove("pin-payment-highlight"), 1800);
}

async function payPinInline() {
  if (!activePinSession?.sessionId) return;

  const payBtn = document.getElementById("pinPayBtn");
  if (payBtn) payBtn.disabled = true;
  showPinPayment(activePinSession, "Préparation du paiement…");

  const result = await paySessionService("pin", {
    session: activePinSession,
    saveSession: (session) => {
      activePinSession = session;
    },
    onStatus: (msg) => showPinPayment(activePinSession, msg),
    onComplete: (data) => {
      activePinSession = data.session;
      showPinPayment(data.session, '<span class="status-active">CID épinglé — paiement confirmé</span>');
      loadDiscoverEntries();
      loadLocalPins();
      refreshStatus();
    },
  });

  if (!result.ok) {
    showPinPayment(
      activePinSession,
      `${result.error || "Paiement impossible"}` +
        (result.data?.balance != null
          ? ` — solde ${Number(result.data.balance).toFixed(4)} TAJ, requis ${result.data.required ?? activePinSession.amount} TAJ`
          : "")
    );
    if (payBtn) payBtn.disabled = false;
    return;
  }

  activePinSession = result.session;
  if (result.done) {
    showPinPayment(
      result.session,
      `<span class="status-active">CID épinglé — paiement confirmé</span> · TX <code>${result.data.txid}</code>`
    );
    loadDiscoverEntries();
    loadLocalPins();
    refreshStatus();
    return;
  }

  showPinPayment(
    result.session,
    `TX envoyée — attente confirmation… · <code>${result.data.txid}</code> · via ${result.data.paidVia === "wallet" ? "wallet" : "nœud local"}`
  );
}

function copyPinAddress() {
  const el = document.getElementById("pinPayAddr");
  if (el?.textContent) {
    navigator.clipboard?.writeText(el.textContent.trim());
  }
}

async function pinDiscoverEntry(txid) {
  try {
    const res = await fetch(`/api/discover/entries/${encodeURIComponent(txid)}/pin`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Échec épinglage");
      return;
    }
    if (data.alreadyPinned) {
      alert("Déjà épinglé sur ce nœud.");
    } else {
      alert("CID épinglé localement (opérateur).");
    }
    loadDiscoverEntries();
    loadLocalPins();
    refreshStatus();
  } catch {
    alert("Erreur réseau");
  }
}

async function viewContentForReward(txid) {
  const wallet = await ensureWalletForPay();
  if (!wallet.ok) {
    alert(wallet.error || "Connectez MetaMask pour attester votre consultation");
    return;
  }
  try {
    await fetch(`/api/discover/entries/${encodeURIComponent(txid)}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...walletPayHeaders() },
      body: JSON.stringify({ claimAddress: tajCoinAuth.tajcoinAddress }),
    });
  } catch {
    /* attestation best-effort — fiche /view confirme aussi */
  }

  let targetUrl = `/view?txid=${encodeURIComponent(txid)}`;
  try {
    const res = await fetch(`/api/discover/entries/${encodeURIComponent(txid)}`, {
      headers: walletPayHeaders(),
    });
    const data = await res.json();
    const entry = data.entry;
    if (entry?.type === "cv" && entry.cvFicheUrl) {
      targetUrl = entry.cvFicheUrl;
    }
  } catch {
    /* fallback /view */
  }

  window.open(targetUrl, "_blank", "noopener,noreferrer");
  setTimeout(loadDiscoverEntries, 1500);
}

async function claimDiscoverReward(txid) {
  try {
    const wallet = await ensureWalletForPay();
    if (!wallet.ok) {
      alert(wallet.error || "Connexion MetaMask requise");
      return;
    }

    const res = await fetch(`/api/discover/entries/${encodeURIComponent(txid)}/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...walletPayHeaders(),
      },
      body: JSON.stringify({ claimAddress: tajCoinAuth.tajcoinAddress }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || data.eligibility?.reason || "Réclamation impossible");
      return;
    }
    if (data.status === "paid") {
      const readerPaid =
        data.splits?.find((row) => row.role === "reader")?.amount ??
        data.splitPlan?.amounts?.reader ??
        data.amount;
      alert(`Réclamation réussie — ${readerPaid} TAJ versés.\nTX : ${data.paymentTxid}`);
    } else if (data.status === "ineligible") {
      alert(data.error || "Consultez d'abord le contenu épinglé");
    } else if (data.status === "already_claimed") {
      alert("Vous avez déjà réclamé votre part pour ce contenu.");
    } else {
      alert(data.settlement?.error || data.error || "Réclamation non effectuée");
    }
    loadDiscoverEntries();
    loadLocalPins();
    refreshStatus();
  } catch {
    alert("Erreur réseau");
  }
}

async function requestPinService(txid) {
  try {
    const res = await fetch(`/api/discover/entries/${encodeURIComponent(txid)}/pin-request`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Commande pinning impossible");
      return;
    }
    if (!data.session?.paymentAddress) {
      alert("Réponse pinning invalide — session sans adresse de paiement");
      return;
    }
    await loadPinPayOptions();
    showPinPayment(data.session);
    await payPinInline();
  } catch (err) {
    console.error("requestPinService:", err);
    alert(err?.message?.includes("activePinSession") ? "Erreur panel pinning — rechargez la page" : "Erreur réseau");
  }
}

async function checkPinSession(silent = false) {
  if (!activePinSession?.sessionId) return false;

  const result = await checkSessionService("pin", activePinSession.sessionId, {
    silent,
    saveSession: (session) => {
      activePinSession = session;
    },
  });

  if (!result.ok) {
    if (!silent) alert(result.error || "Erreur vérification");
    return false;
  }

  activePinSession = result.data.session;
  if (result.done) {
    if (!silent) {
      showPinPayment(result.data.session, '<span class="status-active">Paiement reçu — CID épinglé sur ce nœud.</span>');
    } else {
      document.getElementById("pinPayment")?.classList.add("hidden");
      activePinSession = null;
    }
    loadDiscoverEntries();
    loadLocalPins();
    refreshStatus();
    return true;
  }

  if (!silent) showPinPayment(result.data.session);
  refreshStatus();
  return false;
}

async function loadLocalPins() {
  const listEl = document.getElementById("localPins");
  if (!listEl) return;
  try {
    const res = await fetch("/api/discover/pins?limit=10");
    const data = await res.json();
    if (!res.ok || !data.pins?.length) {
      listEl.innerHTML = `<li class="entry-meta">Aucun pin local enregistré.</li>`;
      return;
    }
    listEl.innerHTML = data.pins
      .map(
        (pin) =>
          `<li><div class="entry-title">${pin.title || pin.contentCid}</div>` +
          `<div class="entry-meta"><code>${pin.contentCid}</code>` +
          (pin.paid ? ` — récompense ${pin.amount} TAJ versée` : "") +
          (pin.claim?.status === "paid" ? ` — tx ${pin.claim.paymentTxid?.slice(0, 12)}…` : "") +
          (pin.claim?.status === "already_claimed" ? " — déjà réclamé" : "") +
          (pin.claim?.status === "awaiting_payment" ? " — paiement en attente" : "") +
          `</div></li>`
      )
      .join("");
  } catch {
    listEl.innerHTML = "";
  }
}

async function loadDiscoverNodes() {
  const nodesEl = document.getElementById("discoverNodes");
  if (!nodesEl) return;

  try {
    const res = await fetch("/api/discover/nodes");
    const data = await res.json();
    if (!res.ok) return;

    if (!data.nodes?.length) {
      nodesEl.textContent = "Annuaire nœuds vide — activez « visible » pour apparaître ou ajoutez des partenaires via API.";
      return;
    }

    nodesEl.innerHTML =
      `<strong>Nœuds Discover :</strong><ul>` +
      data.nodes
        .map(
          (node) =>
            `<li>${node.name} — ${node.endpoint || "sans URL"} — ${node.pinPriceTaj ?? "?"} TAJ</li>`
        )
        .join("") +
      `</ul>`;
  } catch {
    nodesEl.textContent = "";
  }
}

function updateMatomo(matomo) {
  const block = document.getElementById("matomo");
  const statusEl = document.getElementById("matomoStatus");
  const linkEl = document.getElementById("matomoLink");
  const frameEl = document.getElementById("matomoFrame");

  if (matomo?.restricted || matomo?.allowed === false) {
    if (block) block.classList.add("hidden");
    if (frameEl) {
      frameEl.src = "about:blank";
      frameEl.classList.add("hidden");
    }
    matomoEmbedVisible = false;
    return;
  }

  if (block) block.classList.remove("hidden");

  if (!matomo) {
    if (statusEl) {
      statusEl.innerHTML = '<span class="status-offline">Matomo — statut inconnu</span>';
    }
    return;
  }

  matomoDashboardUrl = matomo.dashboardUrl || matomo.url || matomoDashboardUrl;
  matomoEmbedUrl = normalizeMatomoEmbedUrl(matomo.embedUrl || matomoDashboardUrl);
  if (linkEl) linkEl.href = matomoDashboardUrl;

  if (statusEl) {
    if (matomo.online) {
      statusEl.innerHTML =
        `Matomo : <span class="status-active">online</span> — site #${matomo.siteId}` +
        (matomo.trackingUrl ? ` — tracking <code>${matomo.trackingUrl}</code>` : "") +
        (matomo.tracking ? ' — <span class="status-active">actif</span>' : "");
    } else {
      statusEl.innerHTML =
        `<span class="status-offline">Matomo offline</span>${matomo.error ? ` (${matomo.error})` : ""}`;
    }
  }

  const snippetBlock = document.getElementById("matomoSnippetBlock");
  const snippetEl = document.getElementById("matomoSnippet");
  if (snippetBlock && snippetEl && matomo.trackingSnippet) {
    snippetBlock.classList.remove("hidden");
    snippetEl.textContent = matomo.trackingSnippet;
  } else if (snippetBlock) {
    snippetBlock.classList.add("hidden");
  }

  if (matomoEmbedVisible && matomo.online && frameEl) {
    frameEl.src = normalizeMatomoEmbedUrl(matomoEmbedUrl);
  }
}

function normalizeMatomoEmbedUrl(url) {
  if (!url) return url;
  const trimmed = String(url).replace(/\/$/, "");
  return `${trimmed}/`;
}

function toggleMatomoEmbed() {
  const frameEl = document.getElementById("matomoFrame");
  const btnEl = document.getElementById("matomoToggleBtn");

  matomoEmbedVisible = !matomoEmbedVisible;

  if (matomoEmbedVisible) {
    frameEl.src = normalizeMatomoEmbedUrl(matomoEmbedUrl);
    frameEl.classList.remove("hidden");
    btnEl.textContent = "Masquer";
  } else {
    frameEl.src = "about:blank";
    frameEl.classList.add("hidden");
    btnEl.textContent = "Afficher ici";
  }
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

function initMatomoTracking(matomo) {
  if (matomo?.restricted || matomo?.allowed === false || !matomo?.tracking || window.__tajnetMatomoLoaded) {
    return;
  }

  window.__tajnetMatomoLoaded = true;
  const _paq = (window._paq = window._paq || []);
  _paq.push(["trackPageView"]);
  _paq.push(["enableLinkTracking"]);

  const trackerBase = matomo.embedUrl || matomo.url;
  const base = matomoTrackerBase(trackerBase);
  _paq.push(["setTrackerUrl", `${base}matomo.php`]);
  _paq.push(["setSiteId", matomo.siteId]);

  const script = document.createElement("script");
  script.async = true;
  script.src = `${base}matomo.js`;
  document.head.appendChild(script);
}

Object.assign(window, {
  openGuardSession,
  checkGuardSession,
  payGuardInline,
  payPinInline,
  fundAnnounceInline,
  goToGuard,
  copyGuardAddress,
  requestPinService,
  stakeDiscoverContent,
  payStakeInline,
  checkStakeSession,
  pinDiscoverEntry,
  viewContentForReward,
  claimDiscoverReward,
  checkPinSession,
  copyPinAddress,
  copyAnnounceAddress,
  loadDiscoverEntries,
  enableDiscover,
  disableDiscover,
  scanDiscover,
  saveDiscoverProfile,
  saveLandingProfile,
  exportWalletDat,
  importWalletDat,
  addTajcoinNode,
  importTajcoinNodesBulk,
  removeTajcoinNode,
  searchSuperCv,
  generateBranWeb,
  checkBranWeb,
  toggleMatomoEmbed,
});

refreshStatus();
restoreGuardSession();
loadGuardPayOptions();
loadPinPayOptions();
loadDiscoverEntries();
loadDiscoverNodes();
loadLocalPins();
initCategoryNav();
