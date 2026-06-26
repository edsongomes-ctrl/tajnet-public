"use strict";

const crypto = require("crypto");
const path = require("path");
const PLUGINS_DIR = process.env.PLUGINS_DIR || path.join(__dirname, "../../plugins");
const { tokenize } = require(path.join(PLUGINS_DIR, "super-cv/index"));

function parseSkillFilter(skills) {
  if (!skills) return [];
  if (Array.isArray(skills)) {
    return skills.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  }
  return String(skills)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function buildSearchBlob(entry) {
  return [
    entry.title,
    ...(entry.skills || []),
    ...(entry.keywords || []),
    entry.contentCid,
    entry.txid,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreEntry(entry, queryTokens, requiredSkills = []) {
  if (requiredSkills.length) {
    const entrySkills = (entry.skills || []).map((s) => s.toLowerCase());
    const hasAll = requiredSkills.every((skill) =>
      entrySkills.some((s) => s.includes(skill) || skill.includes(s))
    );
    if (!hasAll) {
      return 0;
    }
  }

  if (!queryTokens.length) {
    return requiredSkills.length ? 1 : 0;
  }

  const blob = buildSearchBlob(entry);
  const skillSet = new Set((entry.skills || []).map((s) => s.toLowerCase()));
  const keywordSet = new Set(entry.keywords || []);

  let score = 0;
  for (const token of queryTokens) {
    if (skillSet.has(token)) {
      score += 12;
      continue;
    }
    if ([...skillSet].some((skill) => skill.includes(token) || token.includes(skill))) {
      score += 8;
      continue;
    }
    if (keywordSet.has(token)) {
      score += 5;
      continue;
    }
    if (blob.includes(token)) {
      score += 2;
    }
  }

  if (entry.title && queryTokens.some((t) => entry.title.toLowerCase().includes(t))) {
    score += 3;
  }

  return score;
}

function rankEntries(entries, { q = "", skills = "", limit = 20 } = {}) {
  const queryTokens = tokenize(q);
  const requiredSkills = parseSkillFilter(skills);

  const ranked = entries
    .map((entry) => ({
      entry,
      score: scoreEntry(entry, queryTokens, requiredSkills),
    }))
    .filter((item) => item.score > 0 || (requiredSkills.length && !queryTokens.length))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.entry.indexedAt || "").localeCompare(String(a.entry.indexedAt || ""));
    });

  const total = ranked.length;
  const results = ranked.slice(0, limit).map(({ entry, score }) => ({
    ...entry,
    score,
    matchedSkills: (entry.skills || []).filter((skill) => {
      const lower = skill.toLowerCase();
      return (
        queryTokens.some((t) => lower.includes(t) || t.includes(lower)) ||
        requiredSkills.some((t) => lower.includes(t) || t.includes(lower))
      );
    }),
  }));

  return { total, results, query: q, skills: requiredSkills };
}

function profileFromDiscoverEntry(entry) {
  const meta = entry.metadata || {};
  const extra = meta.extra || {};
  const skills = extra.skills || meta.skills || [];

  return {
    id: entry.txid?.slice(0, 16) || entry.contentCid?.slice(0, 16),
    title: meta.title || entry.title || "cv",
    skills,
    keywords: tokenize([meta.title, ...(skills || []), meta.description].filter(Boolean).join(" ")),
    tokenCount: 0,
    contentCid: meta.contentCid || entry.contentCid,
    txid: entry.txid,
    metadataCid: entry.metadataCid,
    indexedAt: entry.discoveredAt || null,
    source: entry.source || "discover",
    blockHeight: entry.blockHeight,
  };
}

function cvProfileAliasKeys(entry) {
  const keys = new Set();
  if (entry?.contentCid) keys.add(`cid:${entry.contentCid}`);
  if (entry?.txid) {
    keys.add(`tx:${entry.txid}`);
    if (entry.txid.length >= 16) keys.add(`txpref:${entry.txid.slice(0, 16)}`);
  }
  if (entry?.metadataCid) keys.add(`meta:${entry.metadataCid}`);
  if (entry?.id) keys.add(`id:${entry.id}`);
  return [...keys];
}

function mergeCvProfiles(primary, secondary) {
  const preferLocal = (a, b) => (a.source === "local" ? a : b.source === "local" ? b : a);
  const a = preferLocal(primary, secondary);
  const b = a === primary ? secondary : primary;

  const skills =
    (a.skills?.length || 0) >= (b.skills?.length || 0) ? a.skills || [] : b.skills || [];
  const keywords =
    (a.keywords?.length || 0) >= (b.keywords?.length || 0) ? a.keywords || [] : b.keywords || [];

  return {
    ...b,
    ...a,
    id: a.id || b.id,
    title: a.title || b.title,
    skills,
    keywords,
    tokenCount: Math.max(a.tokenCount || 0, b.tokenCount || 0),
    contentCid: a.contentCid || b.contentCid,
    txid: a.txid || b.txid,
    metadataCid: a.metadataCid || b.metadataCid,
    blockHeight: a.blockHeight ?? b.blockHeight ?? null,
    indexedAt: a.indexedAt || b.indexedAt,
    source: a.source === "local" || b.source === "local" ? "local" : a.source || b.source,
  };
}

function dedupeCvProfiles(entries) {
  const aliasToCanon = new Map();
  const canonical = new Map();

  function findCanonKey(entry) {
    for (const alias of cvProfileAliasKeys(entry)) {
      if (aliasToCanon.has(alias)) return aliasToCanon.get(alias);
    }
    return null;
  }

  function register(entry, canonKey) {
    canonical.set(canonKey, entry);
    for (const alias of cvProfileAliasKeys(entry)) {
      aliasToCanon.set(alias, canonKey);
    }
  }

  for (const entry of entries) {
    if (!entry) continue;
    const existingKey = findCanonKey(entry);
    if (existingKey) {
      const merged = mergeCvProfiles(canonical.get(existingKey), entry);
      register(merged, existingKey);
      continue;
    }
    const canonKey = cvProfileAliasKeys(entry)[0] || `id:${entry.id || crypto.randomBytes(8).toString("hex")}`;
    register(entry, canonKey);
  }

  return [...canonical.values()];
}

module.exports = {
  rankEntries,
  scoreEntry,
  profileFromDiscoverEntry,
  parseSkillFilter,
  cvProfileAliasKeys,
  mergeCvProfiles,
  dedupeCvProfiles,
};
