(function () {
  const params = new URLSearchParams(window.location.search);
  const txid = params.get("txid");
  const meta = params.get("meta") || params.get("cid");

  const root = document.getElementById("viewRoot");
  const loadingEl = document.getElementById("viewLoading");
  const errorEl = document.getElementById("viewError");

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(ts) {
    if (!ts) return "—";
    const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("fr-FR");
  }

  function formatSize(bytes) {
    if (!bytes || Number.isNaN(Number(bytes))) return "—";
    const n = Number(bytes);
    if (n < 1024) return `${n} o`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
    return `${(n / (1024 * 1024)).toFixed(2)} Mo`;
  }

  function protocolLabel(protocol) {
    const map = {
      tajnet: "TajNet",
      "tajnet-binary": "TajNet",
      tajnetv1: "TAJNETv1",
      "tajcoin-cid": "Tajcoin",
    };
    return map[protocol] || protocol || "TajNet";
  }

  function normalizeView(view) {
    const metadata = view.metadata || {};
    const contentCid =
      view.contentCid || metadata.contentCid || metadata.fileCid || metadata.cid || null;
    const title = view.title || metadata.title || "";
    const isHtml =
      view.isHtml ||
      view.type === "page" ||
      /\.html?$/i.test(title) ||
      /\.html?$/i.test(String(metadata.fileCid || ""));

    return { ...view, contentCid, isHtml };
  }

  function contentGatewayUrl(view) {
    if (view.contentUrl) return view.contentUrl;
    if (view.contentCid) {
      return `${window.location.origin.replace(/\/$/, "")}/ipfs/${view.contentCid}`;
    }
    return null;
  }

  function publicGatewayUrl(view) {
    if (view.publicContentUrl) return view.publicContentUrl;
    if (view.contentCid) {
      return `https://dweb.link/ipfs/${view.contentCid}`;
    }
    return null;
  }

  function isViewOperatorLocal() {
    if (typeof isLocalhostClient === "function") {
      return isLocalhostClient();
    }
    const host = window.location.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  }

  function renderPoolSection(view) {
    const pool = view.contentPool;
    if (!pool || Number(pool.totalContributed) <= 0) return "";
    const per = Number(pool.rewardPerClaim || 0.5);
    const readerShare = Number(pool.readerSharePerClaim ?? per * 0.25);
    const txid = view.txid;
    const eligibility = view.claimEligibility;
    const canClaim = Number(pool.availableTaj) + 1e-8 >= per;
    const alreadyClaimed = eligibility?.alreadyClaimed;
    const pinned = eligibility?.pinnedOnNode ?? view.localPinned;
    const viewed = eligibility?.viewedContent;

    let actions = "";
    if (txid && pinned && canClaim && !alreadyClaimed) {
      if (viewed) {
        actions = `<button type="button" class="btn btn-primary" id="viewClaimBtn">Réclamer ${readerShare} TAJ</button>`;
      }
    } else if (!pinned && canClaim) {
      actions = `<p class="content-gateway-lead">Cagnotte en attente d'épinglage sur ce nœud.</p>`;
    } else if (alreadyClaimed) {
      actions = `<span class="badge badge-reward">Réclamation effectuée</span>`;
    }

    const pinnedHint = pinned
      ? `<div class="meta-row"><span class="meta-label">Statut</span><span class="meta-value">Épinglé sur ce nœud</span></div>`
      : "";

    return `<section class="meta-card pool-card">
      <h2>Récompense TAJ</h2>
      <div class="meta-row"><span class="meta-label">Cagnotte</span><span class="meta-value"><strong>${Number(pool.totalContributed).toFixed(2)} TAJ</strong> (${Number(pool.availableTaj).toFixed(2)} dispo)</span></div>
      <div class="meta-row"><span class="meta-label">Votre part</span><span class="meta-value">${readerShare} TAJ (sur ${per} TAJ répartis)</span></div>
      ${pinnedHint}
      <div class="content-gateway-actions">${actions}</div>
      <p class="view-pool-status hidden" id="viewPoolStatus" role="status"></p>
    </section>`;
  }

  function renderStakingSection(view) {
    const metrics = view.contentMetrics;
    const summary = view.stakingSummary;
    if (!view.contentCid) return "";
    const score = metrics?.score ?? 0;
    const minStake = view.minStakeTaj ?? 1;

    return `<section class="meta-card pool-card">
      <h2>Investir (staking)</h2>
      <div class="meta-row"><span class="meta-label">Score contenu</span><span class="meta-value"><strong>${score}</strong></span></div>
      <div class="meta-row"><span class="meta-label">Staké actif</span><span class="meta-value">${Number(summary?.totalStaked || 0).toFixed(2)} TAJ</span></div>
      <p class="content-gateway-lead">Investissez un montant libre (min. ${minStake} TAJ) pour 1 à 12 mois. Le rendement dépend de la durée et de l'évolution du score. Vous pouvez staker sur votre propre contenu pour le mettre en avant (boost Discover).</p>
      <div class="content-gateway-actions">
        <a class="btn btn-primary" href="/panel/#discover">Staker via TajPanel ↗</a>
      </div>
    </section>`;
  }

  async function claimFromView(txid) {
    const statusEl = document.getElementById("viewPoolStatus");
    if (statusEl) {
      statusEl.classList.remove("hidden");
      statusEl.textContent = "Connexion MetaMask…";
    }
    const wallet = await ensureWalletForPay();
    if (!wallet.ok) {
      if (statusEl) statusEl.textContent = wallet.error || "MetaMask requis";
      return;
    }
    const res = await fetch(`/api/discover/entries/${encodeURIComponent(txid)}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...walletPayHeaders() },
      body: JSON.stringify({ claimAddress: tajCoinAuth.tajcoinAddress }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (statusEl) statusEl.textContent = data.error || "Réclamation impossible";
      return;
    }
    if (statusEl) {
      statusEl.textContent =
        data.settlement?.status === "paid"
          ? `Réclamation réussie — TX ${data.settlement.paymentTxid}`
          : data.settlement?.error || "Réclamation non effectuée";
    }
    load();
  }

  function bindPoolActions(view) {
    const txid = view.txid;
    if (!txid) return;
    document.getElementById("viewClaimBtn")?.addEventListener("click", () => claimFromView(txid));
  }

  function renderCvPaywall(view) {
    if (view.type !== "cv" || view.cvContentUnlocked || !view.cvHasIpfsContent) {
      return "";
    }
    const price = Number(view.cvAccessPrice ?? 1);
    const fiche = view.cvFicheUrl || (view.cvProfileId ? `/cv?id=${encodeURIComponent(view.cvProfileId)}` : "/panel/#super-cv");
    if (view.cvAccessEnabled === false) {
      return `<section class="meta-card pool-card">
        <h2>Consultation CV</h2>
        <p class="content-gateway-lead">Le service de consultation payante est momentanément indisponible.</p>
        <div class="content-gateway-actions">
          <a class="btn btn-primary btn-lg" href="${esc(fiche)}">Fiche candidat ↗</a>
        </div>
      </section>`;
    }
    return `<section class="meta-card pool-card">
      <h2>Consultation recruteur</h2>
      <p class="content-gateway-lead">Le fichier CV sur IPFS est réservé aux recruteurs. Payez <strong>${price.toFixed(2)} TAJ</strong> via MetaMask sur la fiche candidat pour débloquer le lien.</p>
      <div class="content-gateway-actions">
        <a class="btn btn-primary btn-lg" href="${esc(fiche)}">Fiche candidat — débloquer ${price.toFixed(2)} TAJ ↗</a>
      </div>
    </section>`;
  }

  function render(view) {
    view = normalizeView(view);
    const cvLocked = view.type === "cv" && view.cvHasIpfsContent && !view.cvContentUnlocked;
    const contentUrl = cvLocked ? null : contentGatewayUrl(view);
    const dwebUrl = cvLocked ? null : publicGatewayUrl(view);
    const pool = view.contentPool;
    const views = Number(view.contentMetrics?.visits ?? 0);
    const rewardBadge =
      pool && Number(pool.totalContributed) > 0
        ? `<span class="badge badge-reward">Cagnotte ${Number(pool.totalContributed).toFixed(2)} TAJ</span>`
        : view.pinRewardTaj > 0
          ? `<span class="badge badge-reward">${esc(view.pinRewardTaj)} TAJ cagnotte créateur</span>`
          : "";

    const contentBlock = contentUrl
      ? `<section class="content-gateway-card">
          <div class="content-gateway-head">
            <h2>Contenu publié</h2>
            <p class="content-gateway-lead">Consultez le fichier hébergé sur IPFS via la gateway de ce nœud.</p>
          </div>
          <div class="content-gateway-cid">
            <span class="meta-label">CID contenu</span>
            <code>${esc(view.contentCid)}</code>
          </div>
          <div class="content-gateway-actions">
            <a class="btn btn-primary btn-lg" href="${esc(contentUrl)}" target="_blank" rel="noopener noreferrer">Consulter le contenu ↗</a>
            ${
              dwebUrl && dwebUrl !== contentUrl
                ? `<a class="btn btn-lg" href="${esc(dwebUrl)}" target="_blank" rel="noopener noreferrer">Gateway public (dweb.link) ↗</a>`
                : ""
            }
          </div>
          <p class="content-gateway-url">
            <span class="meta-label">Lien gateway</span>
            <a href="${esc(contentUrl)}" target="_blank" rel="noopener noreferrer">${esc(contentUrl)}</a>
          </p>
          ${
            view.isHtml
              ? `<div class="content-gateway-preview">
                  <p class="preview-label">Aperçu</p>
                  <iframe class="preview-frame" src="${esc(contentUrl)}" title="${esc(view.title)}" sandbox="allow-scripts allow-same-origin"></iframe>
                </div>`
              : ""
          }
        </section>`
      : `<section class="content-gateway-card content-gateway-empty">
          <h2>Contenu publié</h2>
          <p class="content-gateway-lead">CID contenu indisponible — les métadonnées IPFS n'ont pas encore pu être résolues.</p>
        </section>`;

    root.innerHTML =
      `<article class="hero-card">
        <p class="hero-tag">// FICHE PUBLICATION — ${esc(protocolLabel(view.protocol))}</p>
        <h1 class="hero-title">${esc(view.title)}</h1>
        <div class="badges">
          <span class="badge badge-type">${esc(view.type || "file")}</span>
          <span class="badge badge-views" id="viewCountBadge">${views} vue${views !== 1 ? "s" : ""}</span>
          ${rewardBadge}
          ${view.source ? `<span class="badge">${esc(view.source)}</span>` : ""}
        </div>
      </article>
      ${renderPoolSection(view)}
      ${renderStakingSection(view)}
      ${renderCvPaywall(view)}
      ${contentBlock}
      <div class="grid">
        <section class="meta-card">
          <h2>Blockchain</h2>
          <div class="meta-row"><span class="meta-label">Transaction</span><span class="meta-value">${view.txid ? esc(view.txid) : "—"}</span></div>
          <div class="meta-row"><span class="meta-label">Bloc</span><span class="meta-value">${view.blockHeight != null ? esc(view.blockHeight) : "—"}</span></div>
          <div class="meta-row"><span class="meta-label">Date</span><span class="meta-value">${esc(formatDate(view.blockTime || view.timestamp))}</span></div>
        </section>
        <section class="meta-card">
          <h2>Éditeur</h2>
          <div class="meta-row"><span class="meta-label">Adresse Tajcoin</span><span class="meta-value">${view.publisherAddress ? esc(view.publisherAddress) : "—"}</span></div>
          <div class="meta-row"><span class="meta-label">Nœud publisher</span><span class="meta-value">${
            view.publisherEndpoint
              ? `<a href="${esc(view.publisherEndpoint)}" target="_blank" rel="noopener noreferrer">${esc(view.publisherEndpoint)}</a>`
              : "—"
          }</span></div>
        </section>
        <section class="meta-card">
          <h2>Audience</h2>
          <div class="meta-row"><span class="meta-label">Vues</span><span class="meta-value"><strong id="viewCountMeta">${views}</strong></span></div>
          <div class="meta-row"><span class="meta-label">Score contenu</span><span class="meta-value">${view.contentMetrics?.score ?? 0}${view.contentMetrics?.boostScore != null ? ` · boost ${Number(view.contentMetrics.boostScore).toFixed(2)}` : ""}</span></div>
          <div class="meta-row"><span class="meta-label">Dernière vue</span><span class="meta-value">${view.contentMetrics?.lastVisitAt ? esc(formatDate(view.contentMetrics.lastVisitAt)) : "—"}</span></div>
        </section>
        <section class="meta-card">
          <h2>IPFS</h2>
          <div class="meta-row"><span class="meta-label">CID contenu</span><span class="meta-value">${view.contentCid && !cvLocked ? esc(view.contentCid) : cvLocked ? "Verrouillé — consultation recruteur" : "—"}</span></div>
          <div class="meta-row"><span class="meta-label">CID métadonnées</span><span class="meta-value">${view.metadataCid ? esc(view.metadataCid) : "—"}</span></div>
          <div class="meta-row"><span class="meta-label">Taille</span><span class="meta-value">${esc(formatSize(view.sizeBytes))}</span></div>
        </section>
      </div>
      <details class="raw-json">
        <summary>Métadonnées brutes (JSON)</summary>
        <pre>${esc(JSON.stringify(view.metadata || {}, null, 2))}</pre>
      </details>`;

    document.title = `${view.title} — TajNet View`;
    bindPoolActions(view);
  }

  async function load() {
    if (!txid && !meta) {
      loadingEl.classList.add("hidden");
      errorEl.textContent = "Paramètre manquant : ajoutez ?txid=… ou ?meta=CID dans l'URL.";
      errorEl.classList.remove("hidden");
      return;
    }

    const qs = new URLSearchParams();
    if (txid) qs.set("txid", txid);
    if (meta) qs.set("meta", meta);

    try {
      if (typeof tajCoinAuth !== "undefined") {
        tajCoinAuth.restoreSession();
      }
      const res = await fetch(`/api/view/resolve?${qs}`, {
        headers: typeof walletPayHeaders === "function" ? walletPayHeaders() : {},
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Chargement impossible");
      }
      loadingEl.classList.add("hidden");
      render(data.view);
    } catch (err) {
      loadingEl.classList.add("hidden");
      errorEl.textContent = err.message || "Erreur réseau";
      errorEl.classList.remove("hidden");
    }
  }

  load();
})();
