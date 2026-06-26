(function () {
  const DRAFT_KEY = "branWebEditorDraft";
  const DEFAULT_SECTIONS = [
    { name: "bio", label: "bio.md", nav: "I / BIO" },
    { name: "source", label: "source.md", nav: "II / SOURCE" },
  ];

  const titleInput = document.getElementById("archiveTitle");
  const sectionTabs = document.getElementById("sectionTabs");
  const sectionEditor = document.getElementById("sectionEditor");
  const sectionPreview = document.getElementById("sectionPreview");
  const activeSectionLabel = document.getElementById("activeSectionLabel");
  const removeSectionBtn = document.getElementById("removeSectionBtn");
  const addSectionBtn = document.getElementById("addSectionBtn");
  const previewBtn = document.getElementById("previewBtn");
  const publishBtn = document.getElementById("publishBtn");
  const publishPriceLabel = document.getElementById("publishPriceLabel");
  const statusEl = document.getElementById("editorStatus");

  let publishPrice = 2;
  let previewTimer = null;
  let cssCache = null;
  let state = { title: "", sections: [], activeId: null };

  function uid() {
    return crypto.randomUUID?.() || `s${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
  }

  function slugify(name) {
    return String(name || "section")
      .trim()
      .toLowerCase()
      .replace(/\.md$/i, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section";
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", isError);
  }

  function walletHeaders() {
    return typeof walletPayHeaders === "function" ? walletPayHeaders() : {};
  }

  function activeSection() {
    return state.sections.find((s) => s.id === state.activeId) || state.sections[0] || null;
  }

  function persistDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    } catch {
      /* quota */
    }
  }

  function syncTitleFromInput() {
    state.title = titleInput?.value?.trim() || "";
    persistDraft();
  }

  function renderPreview() {
    const section = activeSection();
    const content = section?.content || "";
    if (typeof marked !== "undefined") {
      sectionPreview.innerHTML = content
        ? marked.parse(content)
        : '<p class="loader">Section vide — saisissez du Markdown</p>';
    } else {
      sectionPreview.textContent = content || "(vide)";
    }
    persistDraft();
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 160);
  }

  function renderTabs() {
    if (!sectionTabs) return;
    sectionTabs.innerHTML = "";
    for (const section of state.sections) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "section-tab" + (section.id === state.activeId ? " active" : "");
      btn.textContent = section.label;
      btn.title = section.nav || section.label;
      btn.addEventListener("click", () => selectSection(section.id));
      sectionTabs.appendChild(btn);
    }

    const section = activeSection();
    if (activeSectionLabel) activeSectionLabel.textContent = section?.label || "—";
    if (removeSectionBtn) {
      removeSectionBtn.classList.toggle("hidden", state.sections.length <= 1);
    }
    if (sectionEditor && section) {
      if (document.activeElement !== sectionEditor) {
        sectionEditor.value = section.content;
      }
    }
    renderPreview();
  }

  function selectSection(id) {
    const current = activeSection();
    if (current && sectionEditor) {
      current.content = sectionEditor.value;
    }
    state.activeId = id;
    persistDraft();
    renderTabs();
  }

  function addSection() {
    const raw = window.prompt("Nom de la section (ex: annexes → annexes.md)", "annexes");
    if (raw == null || !raw.trim()) return;

    const name = slugify(raw);
    const label = `${name}.md`;
    if (state.sections.some((s) => s.name === name)) {
      setStatus(`La section ${label} existe déjà.`, true);
      return;
    }

    const ordinals = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
    const nav = `${ordinals[state.sections.length] || state.sections.length + 1} / ${name.toUpperCase()}`;

    const section = {
      id: uid(),
      name,
      label,
      nav,
      content: `# ${name.charAt(0).toUpperCase()}${name.slice(1)}\n\n`,
    };
    state.sections.push(section);
    state.activeId = section.id;
    persistDraft();
    renderTabs();
    sectionEditor?.focus();
    setStatus(`Section ${label} ajoutée.`);
  }

  function removeActiveSection() {
    if (state.sections.length <= 1) return;
    const section = activeSection();
    if (!section) return;
    if (!window.confirm(`Supprimer la section « ${section.label} » ?`)) return;

    state.sections = state.sections.filter((s) => s.id !== section.id);
    state.activeId = state.sections[0]?.id || null;
    persistDraft();
    renderTabs();
    setStatus(`Section ${section.label} supprimée.`);
  }

  async function loadStylesheet() {
    if (cssCache) return cssCache;
    const res = await fetch("style.css");
    cssCache = await res.text();
    return cssCache;
  }

  function validateState() {
    if (!state.title.trim()) {
      throw new Error("Indiquez un titre pour l'archive");
    }
    const filled = state.sections.filter((s) => s.content.trim());
    if (!filled.length) {
      throw new Error("Au moins une section doit contenir du texte");
    }
    return filled;
  }

  async function buildStandaloneHtml(sections) {
    const css = await loadStylesheet();
    const navLinks = sections
      .map(
        (s) =>
          `<li><a href="#section-${s.id}">${escapeHtml(s.nav || s.label.replace(/\.md$/i, ""))}</a></li>`
      )
      .join("\n      ");

    const blocks = sections
      .map((s, index) => {
        const html =
          typeof marked !== "undefined" ? marked.parse(s.content) : `<pre>${escapeHtml(s.content)}</pre>`;
        const cls = s.name === "bio" ? "markdown-body agent-bio" : "markdown-body";
        const tag = index === sections.length - 1 && sections.length > 1 ? "article" : "section";
        const divider = index > 0 ? '\n      <hr class="divider">' : "";
        return `${divider}\n      <${tag} id="section-${s.id}" class="${cls}">${html}</${tag}>`;
      })
      .join("");

    const title = escapeHtml(state.title);

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Share+Tech+Mono&display=swap" rel="stylesheet">
  <style>${css}</style>
</head>
<body class="theme-enfants-foret">
  <div class="orb orb-1"></div><div class="orb orb-2"></div><div class="orb orb-3"></div>
  <nav>
    <a href="#" class="nav-logo">BRAN<span>WEB</span></a>
    <ul class="nav-links">
      ${navLinks}
    </ul>
    <div class="nav-status"><div class="status-dot"></div>ARCHIVE · PUBLIÉ</div>
  </nav>
  <div class="app-wrapper">
    <div id="container" class="book-pages">
      <div class="book-header">
        <span class="running-title">${title}</span>
        <span class="running-page">Bran Web</span>
      </div>${blocks}
    </div>
  </div>
</body>
</html>`;
  }

  async function fetchDefaultContent(name) {
    try {
      const res = await fetch(`${name}.md`);
      if (res.ok) return await res.text();
    } catch {
      /* static fallback */
    }
    return `# ${name}\n\n`;
  }

  async function createDefaultState() {
    const contents = await Promise.all(DEFAULT_SECTIONS.map((s) => fetchDefaultContent(s.name)));
    return {
      title: "Archive Bran Web",
      activeId: null,
      sections: DEFAULT_SECTIONS.map((meta, i) => ({
        id: uid(),
        name: meta.name,
        label: meta.label,
        nav: meta.nav,
        content: contents[i],
      })),
    };
  }

  function applyState(next) {
    state = next;
    if (!state.activeId && state.sections[0]) {
      state.activeId = state.sections[0].id;
    }
    if (titleInput) titleInput.value = state.title || "";
    renderTabs();
  }

  async function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.sections?.length) {
          applyState(parsed);
          setStatus("Brouillon local restauré.");
          return;
        }
      }
    } catch {
      /* invalid draft */
    }

    applyState(await createDefaultState());
    persistDraft();
    setStatus("Sections bio.md et source.md prêtes — tout reste dans votre navigateur.");
  }

  async function loadPublishPrice() {
    try {
      const res = await fetch("/api/bran-web/status");
      const data = await res.json();
      publishPrice = Number(data.branWeb?.publish?.price ?? 2);
    } catch {
      publishPrice = 2;
    }
    if (publishPriceLabel) publishPriceLabel.textContent = `${publishPrice} TAJ`;
  }

  async function openPreview() {
    const current = activeSection();
    if (current && sectionEditor) current.content = sectionEditor.value;

    try {
      const sections = validateState();
      setStatus("Génération de l'aperçu…");
      const html = await buildStandaloneHtml(sections);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setStatus("Aperçu ouvert — gratuit, non publié sur IPFS.");
    } catch (err) {
      setStatus(err.message || "Aperçu impossible", true);
    }
  }

  async function publishToIpfs() {
    const current = activeSection();
    if (current && sectionEditor) current.content = sectionEditor.value;

    let sections;
    try {
      sections = validateState();
    } catch (err) {
      setStatus(err.message, true);
      return;
    }

    setStatus("Connexion MetaMask…");
    if (typeof tajCoinAuth !== "undefined") tajCoinAuth.restoreSession();

    const wallet = await ensureWalletForPay();
    if (!wallet.ok) {
      setStatus(wallet.error || "MetaMask requis pour publier", true);
      return;
    }

    setStatus("Préparation HTML…");
    let html;
    try {
      html = await buildStandaloneHtml(sections);
    } catch (err) {
      setStatus(err.message || "HTML impossible", true);
      return;
    }

    setStatus(`Création session (${publishPrice} TAJ)…`);
    const reqRes = await fetch("/api/bran-web/publish/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...walletHeaders() },
      body: JSON.stringify({ html, title: state.title }),
    });
    const reqData = await reqRes.json();
    if (!reqRes.ok) {
      setStatus(reqData.error || "Session publication impossible", true);
      return;
    }

    const result = await paySessionService("branPublish", {
      session: reqData.session,
      onStatus: setStatus,
      onComplete: (data) => {
        const s = data?.session;
        if (s?.contentCid) {
          const url = s.gatewayUrl || `${window.location.origin}/ipfs/${s.contentCid}`;
          setStatus(`Publié — CID ${s.contentCid.slice(0, 12)}… · ${url}`);
        }
      },
    });

    if (result.ok && result.done && result.data?.session?.contentCid) {
      const s = result.data.session;
      setStatus(
        `Publication confirmée — ${s.contentCid}${s.announceTxid ? ` · tx ${s.announceTxid.slice(0, 12)}…` : ""}`
      );
    } else if (!result.ok) {
      setStatus(result.error || "Paiement impossible", true);
    }
  }

  titleInput?.addEventListener("input", () => {
    syncTitleFromInput();
  });

  sectionEditor?.addEventListener("input", () => {
    const section = activeSection();
    if (section) section.content = sectionEditor.value;
    schedulePreview();
  });

  addSectionBtn?.addEventListener("click", addSection);
  removeSectionBtn?.addEventListener("click", removeActiveSection);
  previewBtn?.addEventListener("click", openPreview);
  publishBtn?.addEventListener("click", publishToIpfs);

  if (typeof tajCoinAuth !== "undefined") tajCoinAuth.restoreSession();

  Promise.all([loadPublishPrice(), loadDraft()]);
})();
