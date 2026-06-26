"use strict";

let editor = null;
let editorConfig = { ipfs: { online: false }, matomo: { tracking: false }, guard: { locked: true } };

function updateGuardStatus() {
  const el = document.getElementById("guardStatus");
  const elMobile = document.getElementById("guardStatusMobile");
  const payBtn = document.getElementById("guardPayBtn");
  const payBtnMobile = document.getElementById("guardPayBtnMobile");
  if (!el && !elMobile) return;

  const guard = editorConfig.guard || {};
  let text = "Guard…";
  let className = "editor-status offline";
  let showPay = false;
  let payLabel = `Payer ${guard.price || 1} TAJ`;

  if (guard.bypass) {
    text = "Guard bypass";
    className = "editor-status online";
  } else if (isGuardSessionUnlocked()) {
    text = "Guard ouvert";
    className = "editor-status online";
  } else {
    text = guard.locked ? `Guard verrouillé (${guard.price || "?"} TAJ)` : "Guard…";
    showPay = true;
  }

  [el, elMobile].forEach((node) => {
    if (!node) return;
    node.textContent = text;
    node.className = className;
  });
  [payBtn, payBtnMobile].forEach((node) => {
    if (!node) return;
    node.classList.toggle("hidden", !showPay);
    if (showPay) node.textContent = payLabel;
  });
}

async function payEditorGuard() {
  const payBtn = document.getElementById("guardPayBtn");
  if (payBtn) {
    payBtn.disabled = true;
    payBtn.textContent = "Paiement…";
  }

  const result = await paySessionService("guard", {
    ensureSession: async () => {
      const res = await fetch("/api/guard/session", { method: "POST" });
      const data = await res.json();
      if (!res.ok) return false;
      saveGuardSession(data.session);
      editorConfig.guard = data.guard;
      return true;
    },
    getSessionAfterEnsure: () => getGuardSession(),
    onStatus: (msg) => {
      if (payBtn) payBtn.textContent = msg;
    },
    onComplete: () => updateGuardStatus(),
  });

  if (payBtn) payBtn.disabled = false;
  updateGuardStatus();

  if (!result.ok) {
    showToast(result.error || "Paiement Guard impossible", "error");
    return;
  }

  if (result.done) {
    showToast("Guard ouvert — vous pouvez publier", "success");
  } else if (result.pending) {
    showToast("TX envoyée — attente confirmation…", "success");
  }
}

function showToast(message, type = "success") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function openModal(id) {
  document.getElementById(id).classList.add("open");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

async function loadConfig() {
  try {
    const res = await fetch("/api/editor/config");
    if (res.ok) {
      editorConfig = await res.json();
    }
  } catch {
    /* ignore */
  }

  const ipfsOnline = Boolean(editorConfig.ipfs?.online);
  ["ipfsStatus", "ipfsStatusMobile"].forEach((id) => {
    const statusEl = document.getElementById(id);
    if (!statusEl) return;
    statusEl.textContent = ipfsOnline ? "IPFS online" : "IPFS offline";
    statusEl.className = ipfsOnline ? "editor-status online" : "editor-status offline";
  });

  updateGuardStatus();

  const matomoNote = document.getElementById("matomoNote");
  if (matomoNote) {
    if (editorConfig.matomo?.restricted || editorConfig.matomo?.allowed === false) {
      matomoNote.textContent = "Matomo disponible en localhost/LAN uniquement.";
    } else {
      matomoNote.textContent = editorConfig.matomo?.tracking
        ? "Les publications depuis ce réseau peuvent inclure le tracking Matomo."
        : "Matomo offline ou tracking désactivé.";
    }
  }
}

function getPageTitle() {
  const desktop = document.getElementById("pageTitle");
  const mobile = document.getElementById("pageTitleMobile");
  const value = (desktop?.value || mobile?.value || "").trim();
  if (desktop && mobile && desktop.value !== mobile.value) {
    const active = document.body.classList.contains("editor-mobile") ? mobile : desktop;
    return (active.value || value).trim() || "Page TajNet";
  }
  return value || "Page TajNet";
}

function syncPageTitles(fromId, toId) {
  const from = document.getElementById(fromId);
  const to = document.getElementById(toId);
  if (from && to && from.value !== to.value) to.value = from.value;
}

async function publishToIpfs() {
  const btn = document.getElementById("publishBtn");
  const btnMobile = document.getElementById("publishBtnMobile");
  const title = getPageTitle();

  if (!editorConfig.ipfs?.online) {
    showToast("IPFS hors ligne — démarrez votre nœud Kubo", "error");
    return;
  }

  if (!editorConfig.guard?.bypass && !isGuardSessionUnlocked()) {
    showToast(guardRequiredMessage(), "error");
    await payEditorGuard();
    if (!isGuardSessionUnlocked()) return;
  }

  [btn, btnMobile].forEach((node) => {
    if (!node) return;
    node.disabled = true;
    node.textContent = "Publication…";
  });
  closeHeaderSheet();

  try {
    const res = await fetch("/api/publish", {
      method: "POST",
      headers: guardSessionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        html: editor.getHtml(),
        css: editor.getCss({ keepUnusedStyles: true }),
        js: editor.getJs(),
        title,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 402) {
        clearGuardSession();
        updateGuardStatus();
        await payEditorGuard();
        if (!isGuardSessionUnlocked()) {
          throw new Error(data.message || data.error || "Session Guard requise");
        }
        return publishToIpfs();
      }
      throw new Error(data.message || data.error || data.detail || "Publication échouée");
    }

    document.getElementById("resultCid").textContent = data.cid;
    document.getElementById("resultGateway").href = data.gatewayUrl;
    document.getElementById("resultGateway").textContent = data.gatewayUrl;
    document.getElementById("resultDweb").href = data.dwebUrl;
    document.getElementById("resultDweb").textContent = data.dwebUrl;

    const matomoNote = document.getElementById("matomoNote");
    if (matomoNote) {
      matomoNote.textContent = data.matomoInjected
        ? `Tracking Matomo injecté (site #${data.matomoSiteId})`
        : editorConfig.matomo?.restricted
          ? "Publication sans Matomo (accès analytics réservé localhost/LAN)."
          : "Publication sans tracking Matomo.";
    }

    const announceEl = document.getElementById("announceNote");
    if (announceEl) {
      const rows = [];
      rows.push(`<span class="status-badge badge-ipfs">IPFS disponible</span> <code>${data.cid}</code>`);
      if (data.announce?.status === "broadcast") {
        rows.push(
          `<span class="status-badge badge-chain">Blockchain diffusée</span> tx <code>${data.announce.txid?.slice(0, 16)}…</code>` +
            (data.announce.metadataCid ? ` — meta <code>${data.announce.metadataCid}</code>` : "")
        );
        rows.push(`<span class="pub-status-hint">Confirmation réseau : ~2–40 min selon activité Tajcoin</span>`);
      } else if (data.announce?.status === "failed") {
        rows.push(`<span class="status-badge badge-error">Blockchain échouée</span> ${data.announce.error}`);
      } else if (data.announce?.status === "skipped") {
        rows.push(`<span class="status-badge badge-pending">Blockchain ignorée</span> ${data.announce.reason || "désactivée"}`);
      }
      announceEl.innerHTML = `<div class="pub-status">${rows.map((r) => `<div class="pub-status-row">${r}</div>`).join("")}</div>`;
    }

    openModal("publishModal");
    showToast("Page publiée sur IPFS", "success");
  } catch (err) {
    showToast(err.message || "Erreur de publication", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🚀 Publier IPFS";
    }
    if (btnMobile) {
      btnMobile.disabled = false;
      btnMobile.textContent = "🚀 Publier sur IPFS";
    }
  }
}

function importCode() {
  const code = document.getElementById("codeInput").value.trim();
  if (!code) {
    showToast("Collez du code HTML avant d'importer", "error");
    return;
  }

  try {
    const bodyMatch = code.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const htmlContent = bodyMatch ? bodyMatch[1] : code;

    const styleMatches = code.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
    let cssContent = "";
    if (styleMatches) {
      styleMatches.forEach((match) => {
        cssContent += `${match.replace(/<\/?style[^>]*>/gi, "")}\n`;
      });
    }

    editor.setComponents(htmlContent);
    if (cssContent) {
      editor.setStyle(cssContent);
    }

    closeModal("importModal");
    showToast("Code importé", "success");
  } catch (err) {
    showToast(`Import impossible : ${err.message}`, "error");
  }
}

const MOBILE_MQ = window.matchMedia("(max-width: 768px)");
const DEVICE_CYCLE = ["Mobile", "Tablet", "Desktop"];
let activeMobilePanel = null;

function isMobileEditor() {
  return MOBILE_MQ.matches;
}

function closeMobilePanels() {
  activeMobilePanel = null;
  document.body.classList.remove("editor-panel-open");
  document.querySelectorAll(".mobile-bar-btn[data-panel]").forEach((btn) => {
    btn.classList.remove("active");
    btn.setAttribute("aria-pressed", "false");
  });
  const { views } = getEditorPanelNodes();
  views?.classList.remove("editor-panel-active");
  const backdrop = document.getElementById("panelBackdrop");
  if (backdrop) backdrop.hidden = true;
  refreshEditorCanvas();
}

function getEditorPanelNodes() {
  const root = editor?.getContainer?.();
  if (!root) return { views: null };
  return {
    views: root.querySelector(".gjs-pn-views-container"),
  };
}

function refreshEditorCanvas() {
  if (!editor) return;
  if (typeof editor.refresh === "function") editor.refresh();
  else editor.Canvas?.resize?.();
}

function openMobilePanel(panel) {
  if (!editor || !isMobileEditor()) return;
  if (activeMobilePanel === panel) {
    closeMobilePanels();
    refreshEditorCanvas();
    return;
  }
  closeMobilePanels();
  activeMobilePanel = panel;
  document.body.classList.add("editor-panel-open");
  const { views } = getEditorPanelNodes();
  const backdrop = document.getElementById("panelBackdrop");
  if (backdrop) backdrop.hidden = false;

  const btn = document.querySelector(`.mobile-bar-btn[data-panel="${panel}"]`);
  if (btn) {
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", "true");
  }

  if (panel === "blocks") {
    editor.runCommand("open-blocks");
  } else if (panel === "layers") {
    editor.runCommand("open-layers");
  } else if (panel === "styles") {
    editor.runCommand("open-sm");
  }
  views?.classList.add("editor-panel-active");
  setTimeout(refreshEditorCanvas, 280);
}

function updateDeviceCycleLabel() {
  const btn = document.getElementById("deviceCycleBtn");
  if (!btn || !editor) return;
  const current = editor.getDevice() || "Desktop";
  btn.textContent = current;
}

function cycleDevicePreview() {
  if (!editor) return;
  const current = editor.getDevice() || "Mobile";
  const index = DEVICE_CYCLE.indexOf(current);
  const next = DEVICE_CYCLE[(index + 1) % DEVICE_CYCLE.length];
  editor.setDevice(next);
  updateDeviceCycleLabel();
}

function applyEditorLayoutMode() {
  const mobile = isMobileEditor();
  document.body.classList.toggle("editor-mobile", mobile);
  const bar = document.getElementById("mobileBar");
  if (bar) bar.hidden = !mobile;
  if (mobile) {
    closeMobilePanels();
    editor?.setDevice("Mobile");
    updateDeviceCycleLabel();
  } else {
    closeMobilePanels();
    closeHeaderSheet();
  }
}

function openHeaderSheet() {
  syncPageTitles("pageTitle", "pageTitleMobile");
  const sheet = document.getElementById("headerSheet");
  const btn = document.getElementById("headerMenuBtn");
  sheet?.classList.add("open");
  sheet?.setAttribute("aria-hidden", "false");
  btn?.setAttribute("aria-expanded", "true");
}

function closeHeaderSheet() {
  syncPageTitles("pageTitleMobile", "pageTitle");
  const sheet = document.getElementById("headerSheet");
  const btn = document.getElementById("headerMenuBtn");
  sheet?.classList.remove("open");
  sheet?.setAttribute("aria-hidden", "true");
  btn?.setAttribute("aria-expanded", "false");
}

function setupMobileEditorUi() {
  applyEditorLayoutMode();
  MOBILE_MQ.addEventListener("change", applyEditorLayoutMode);

  document.getElementById("headerMenuBtn")?.addEventListener("click", openHeaderSheet);
  document.getElementById("closeHeaderSheet")?.addEventListener("click", closeHeaderSheet);
  document.getElementById("panelBackdrop")?.addEventListener("click", closeMobilePanels);

  document.querySelectorAll(".mobile-bar-btn[data-panel]").forEach((btn) => {
    btn.addEventListener("click", () => openMobilePanel(btn.dataset.panel));
  });
  document.getElementById("deviceCycleBtn")?.addEventListener("click", cycleDevicePreview);

  document.getElementById("pageTitle")?.addEventListener("input", () => syncPageTitles("pageTitle", "pageTitleMobile"));
  document.getElementById("pageTitleMobile")?.addEventListener("input", () => syncPageTitles("pageTitleMobile", "pageTitle"));

  document.getElementById("importBtnMobile")?.addEventListener("click", () => {
    closeHeaderSheet();
    openModal("importModal");
  });
  document.getElementById("publishBtnMobile")?.addEventListener("click", publishToIpfs);
}

function initEditor() {
  editor = grapesjs.init({
    container: "#gjs",
    height: "100%",
    storageManager: false,
    fromElement: false,
    noticeOnUnload: false,
    canvas: { styles: [], scripts: [] },
    deviceManager: {
      devices: [
        { name: "Desktop", width: "" },
        { name: "Tablet", width: "768px", widthMedia: "992px" },
        { name: "Mobile", width: "375px", widthMedia: "480px" },
      ],
    },
  });

  registerTajnetBlocks(editor);

  editor.on("component:selected", () => {
    if (isMobileEditor() && activeMobilePanel !== "styles") {
      closeMobilePanels();
    }
  });

  editor.on("device:select", updateDeviceCycleLabel);
  editor.on("change:device", updateDeviceCycleLabel);

  editor.setComponents(`
    <section style="padding:80px 20px;text-align:center;background:#0a0a0a;color:#fff">
      <h1 style="font-size:2.5em;color:#00ff41">Bienvenue sur TajNet</h1>
      <p style="color:#888;max-width:600px;margin:20px auto">Éditeur visuel no-code — glissez des blocs, personnalisez, publiez sur IPFS en un clic avec suivi Matomo.</p>
    </section>
  `);
}

document.addEventListener("DOMContentLoaded", () => {
  initEditor();
  setupMobileEditorUi();
  loadConfig();

  document.getElementById("publishBtn").addEventListener("click", publishToIpfs);
  document.getElementById("importBtn").addEventListener("click", () => openModal("importModal"));
  document.getElementById("confirmImport").addEventListener("click", importCode);
  document.getElementById("cancelImport").addEventListener("click", () => closeModal("importModal"));
  document.getElementById("closeImport").addEventListener("click", () => closeModal("importModal"));
  document.getElementById("closePublish").addEventListener("click", () => closeModal("publishModal"));
  document.getElementById("cancelPublish").addEventListener("click", () => closeModal("publishModal"));
  document.getElementById("openPublished").addEventListener("click", () => {
    const link = document.getElementById("resultGateway");
    if (link.href) window.open(link.href, "_blank");
  });

  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.classList.remove("open");
      }
    });
  });
});
