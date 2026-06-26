/**
 * TajNet i18n — 9 languages (client-side).
 * Usage: data-i18n="key" on elements, t("key") in scripts.
 */
(function (global) {
  "use strict";

  const SUPPORTED = ["en", "fr", "de", "es", "pt-BR", "nl", "zh", "ja", "sw"];
  const STORAGE_KEY = "tajnet.lang";
  const cache = {};

  function normalizeLang(code) {
    const raw = String(code || "").trim();
    if (!raw) return "en";
    const lower = raw.toLowerCase();
    if (lower.startsWith("pt")) return "pt-BR";
    if (lower.startsWith("zh")) return "zh";
    if (lower.startsWith("ja")) return "ja";
    if (lower.startsWith("sw")) return "sw";
    if (lower.startsWith("de")) return "de";
    if (lower.startsWith("es")) return "es";
    if (lower.startsWith("nl")) return "nl";
    if (lower.startsWith("fr")) return "fr";
    return "en";
  }

  function detectLang() {
    const params = new URLSearchParams(global.location?.search || "");
    if (params.get("lang")) return normalizeLang(params.get("lang"));
    try {
      const stored = global.localStorage?.getItem(STORAGE_KEY);
      if (stored) return normalizeLang(stored);
    } catch {
      /* ignore */
    }
    const nav = (global.navigator?.language || "en").split(",")[0];
    const guess = normalizeLang(nav);
    return SUPPORTED.includes(guess) ? guess : "en";
  }

  let currentLang = detectLang();

  async function loadLocale(lang) {
    const code = normalizeLang(lang);
    if (cache[code]) return cache[code];
    const res = await fetch(`/shared/locales/${code}.json`, { cache: "no-store" });
    if (!res.ok && code !== "en") return loadLocale("en");
    const data = await res.json();
    cache[code] = data;
    return data;
  }

  function t(key, vars) {
    const dict = cache[currentLang] || cache.en || {};
    let text = dict[key] ?? cache.en?.[key] ?? key;
    if (vars && typeof text === "string") {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return text;
  }

  function applyI18n(root) {
    const scope = root || global.document;
    if (!scope?.querySelectorAll) return;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      const attr = el.getAttribute("data-i18n-attr");
      const value = t(key);
      if (attr) {
        el.setAttribute(attr, value);
      } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        el.placeholder = value;
      } else {
        el.textContent = value;
      }
    });
    scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    if (global.document?.documentElement) {
      global.document.documentElement.lang = currentLang;
    }
  }

  function renderLangSelect(containerId) {
    const el = global.document?.getElementById(containerId);
    if (!el) return;
    el.innerHTML = "";
    const select = global.document.createElement("select");
    select.className = "lang-select";
    select.setAttribute("aria-label", t("lang.label"));
    for (const code of SUPPORTED) {
      const opt = global.document.createElement("option");
      opt.value = code;
      opt.textContent = t(`lang.${code}`);
      if (code === currentLang) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", async () => {
      await setLang(select.value);
    });
    el.appendChild(select);
  }

  async function setLang(lang) {
    currentLang = normalizeLang(lang);
    try {
      global.localStorage?.setItem(STORAGE_KEY, currentLang);
    } catch {
      /* ignore */
    }
    await loadLocale(currentLang);
    applyI18n();
    renderLangSelect("langSelect");
    global.dispatchEvent(new CustomEvent("tajnet:lang", { detail: { lang: currentLang } }));
  }

  async function initI18n(options) {
    await loadLocale("en");
    await loadLocale(currentLang);
    applyI18n();
    if (options?.langSelectId) renderLangSelect(options.langSelectId);
    return { lang: currentLang, t, setLang, applyI18n };
  }

  global.TajI18n = { initI18n, t, setLang, applyI18n, getLang: () => currentLang, SUPPORTED };
})(typeof window !== "undefined" ? window : globalThis);
