function applyLandingProfile(profile) {
  if (!profile) return;

  const logoName = document.getElementById("landingLogoName");
  if (logoName && profile.nodeName) {
    const name = String(profile.nodeName).trim();
    logoName.textContent = name.length <= 8 ? name : name.slice(0, 8);
  }

  const setText = (id, value, html = false) => {
    const el = document.getElementById(id);
    if (!el || value == null) return;
    if (html) {
      el.innerHTML = String(value).replace(/\n/g, "<br>");
    } else {
      el.textContent = value;
    }
  };

  setText("landingTag", profile.tagline);
  setText("landingTitle", profile.heroTitle, true);
  setText("landingLead", profile.heroLead);

  for (const id of ["landingPrimaryCta", "landingPrimaryCtaHero"]) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    if (profile.primaryCtaLabel) btn.textContent = profile.primaryCtaLabel;
    if (profile.primaryCtaUrl) btn.href = profile.primaryCtaUrl;
  }

  const secondary = document.getElementById("landingSecondaryCta");
  if (secondary) {
    if (profile.secondaryCtaLabel) secondary.textContent = profile.secondaryCtaLabel;
    if (profile.secondaryCtaUrl) secondary.href = profile.secondaryCtaUrl;
  }

  const footer = document.getElementById("landingFooter");
  if (footer && profile.footerText) {
    footer.textContent = profile.footerText;
  }

  const contact = document.getElementById("landingContact");
  if (contact) {
    const email = String(profile.contactEmail || "").trim();
    if (email) {
      contact.innerHTML = `Contact : <a href="mailto:${email}">${email}</a>`;
      contact.hidden = false;
    } else {
      contact.hidden = true;
      contact.textContent = "";
    }
  }

  const deploy = document.getElementById("deploiement");
  if (deploy && profile.showDeploymentSection === false) {
    deploy.classList.add("hidden");
    document.querySelectorAll('.sidebar-nav a[href="#deploiement"]').forEach((a) => {
      a.classList.add("hidden");
    });
  }

  if (profile.pageTitle) {
    document.title = profile.pageTitle;
  }
}

function setLiveValue(id, text, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = "live-card-value" + (state ? ` ${state}` : "");
}

function updateLiveStatus(data) {
  if (!data) return;

  const ipfsOk = data.ipfs?.online;
  const tajOk = data.tajcoin?.online;
  setLiveValue("liveIpfs", ipfsOk ? "En ligne" : "Hors ligne", ipfsOk ? "ok" : "off");
  setLiveValue("liveTajcoin", tajOk ? "En ligne" : "Hors ligne", tajOk ? "ok" : "off");
  setLiveValue("liveZone", data.requestZone || "—");
  setLiveValue("liveMode", data.tajnodeMode || "local");
  setLiveValue(
    "liveDiscover",
    data.discover?.enabled
      ? `${data.discover.entryCount ?? 0} entrée(s)`
      : "Désactivé",
    data.discover?.enabled ? "ok" : "warn"
  );
  setLiveValue(
    "liveBlock",
    data.tajcoin?.blockHeight != null ? String(data.tajcoin.blockHeight) : "—"
  );
}

async function refreshLandingStatus() {
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  if (!dot || !text) return;

  try {
    const [statusRes, profileRes] = await Promise.all([
      fetch("/api/status"),
      fetch("/api/landing/profile"),
    ]);
    if (profileRes.ok) {
      const profileData = await profileRes.json();
      applyLandingProfile(profileData.profile);
    }
    if (!statusRes.ok) throw new Error("status");
    const data = await statusRes.json();
    updateLiveStatus(data);

    const ipfsOk = data.ipfs?.online;
    const tajOk = data.tajcoin?.online;

    if (ipfsOk && tajOk) {
      dot.className = "status-dot online";
      text.textContent = data.landing?.nodeName
        ? `${data.landing.nodeName} — opérationnel`
        : "Nœud opérationnel";
    } else if (ipfsOk || tajOk) {
      dot.className = "status-dot partial";
      text.textContent = ipfsOk ? "IPFS OK · Tajcoin en attente" : "Tajcoin OK · IPFS en attente";
    } else {
      dot.className = "status-dot";
      text.textContent = "Services en cours de démarrage…";
    }
  } catch {
    dot.className = "status-dot";
    text.textContent = "Moteur indisponible";
  }
}

function initMobileMenu() {
  const toggle = document.getElementById("menuToggle");
  const sidebar = document.getElementById("docSidebar");
  if (!toggle || !sidebar) return;

  toggle.addEventListener("click", () => {
    sidebar.classList.toggle("open");
  });

  sidebar.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      sidebar.classList.remove("open");
    });
  });
}

function initScrollSpy() {
  const sections = document.querySelectorAll(".doc-article[id]");
  const sidebarLinks = document.querySelectorAll(".sidebar-nav a");
  const tocLinks = document.querySelectorAll(".toc-nav a");

  if (!sections.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = entry.target.id;
        sidebarLinks.forEach((a) => {
          a.classList.toggle("active", a.getAttribute("href") === `#${id}`);
        });
        tocLinks.forEach((a) => {
          a.classList.toggle("active", a.getAttribute("href") === `#${id}`);
        });
      }
    },
    { rootMargin: "-20% 0px -60% 0px", threshold: 0 }
  );

  sections.forEach((s) => observer.observe(s));
}

function buildToc() {
  const tocNav = document.getElementById("tocNav");
  const hero = document.querySelector(".doc-hero");
  if (!tocNav) return;

  tocNav.innerHTML = "";

  if (hero) {
    const heroLink = document.createElement("a");
    heroLink.href = "#introduction";
    heroLink.textContent = "Introduction";
    tocNav.appendChild(heroLink);
  }

  document.querySelectorAll(".doc-article[id]").forEach((article) => {
    const h2 = article.querySelector("h2");
    if (!h2) return;

    const link = document.createElement("a");
    link.href = `#${article.id}`;
    link.textContent = h2.textContent;
    tocNav.appendChild(link);

    article.querySelectorAll("h3").forEach((h3) => {
      const sub = document.createElement("a");
      sub.href = `#${article.id}`;
      sub.textContent = h3.textContent;
      sub.className = "toc-h3";
      tocNav.appendChild(sub);
    });
  });
}

initMobileMenu();
buildToc();
initScrollSpy();
refreshLandingStatus();
setInterval(refreshLandingStatus, 20000);
