"use strict";

const fs = require("fs");
const path = require("path");
const { rankEntries, profileFromDiscoverEntry, dedupeCvProfiles } = require("./cv-search");

function defaultIndex() {
  return {
    version: 1,
    updatedAt: null,
    entries: {},
  };
}

class CvSemanticIndex {
  constructor({ dataDir, discover = null } = {}) {
    this.dataDir = dataDir;
    this.indexPath = path.join(dataDir, "index.json");
    this.discover = discover;
    this.index = defaultIndex();
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.index = this.readJson(this.indexPath, defaultIndex());
  }

  persist() {
    this.index.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.indexPath, `${JSON.stringify(this.index, null, 2)}\n`, "utf8");
  }

  readJson(filePath, fallback) {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      return { ...fallback, ...JSON.parse(fs.readFileSync(filePath, "utf8")) };
    } catch {
      return fallback;
    }
  }

  setDiscover(discover) {
    this.discover = discover;
  }

  upsert(profile) {
    if (!profile?.id) {
      throw new Error("Profil CV invalide");
    }
    this.index.entries[profile.id] = {
      ...this.index.entries[profile.id],
      ...profile,
    };
    this.persist();
    return this.index.entries[profile.id];
  }

  get(id) {
    return this.index.entries[id] || null;
  }

  listLocalEntries() {
    return Object.values(this.index.entries || {});
  }

  collectDiscoverCvEntries() {
    if (!this.discover?.index?.entries) {
      return [];
    }

    return Object.values(this.discover.index.entries)
      .filter((entry) => entry.type === "cv")
      .map((entry) => profileFromDiscoverEntry(entry));
  }

  allSearchableEntries() {
    const combined = [...this.listLocalEntries(), ...this.collectDiscoverCvEntries()];
    return dedupeCvProfiles(combined);
  }

  search(options = {}) {
    const corpus = this.allSearchableEntries();
    return rankEntries(corpus, options);
  }

  status() {
    const local = this.listLocalEntries();
    const discoverCv = this.collectDiscoverCvEntries();
    const deduped = this.allSearchableEntries();
    return {
      localCount: local.length,
      discoverCvCount: discoverCv.length,
      totalSearchable: deduped.length,
      rawEntryCount: local.length + discoverCv.length,
      updatedAt: this.index.updatedAt,
    };
  }

  init() {
    this.load();
    return this.status();
  }
}

module.exports = { CvSemanticIndex };
