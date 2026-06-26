"use strict";

const fs = require("fs");
const path = require("path");

function loadPlugins(pluginsDir) {
  if (!fs.existsSync(pluginsDir)) {
    return [];
  }

  return fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const id = entry.name;
      const basePath = path.join(pluginsDir, id);
      const manifestPath = path.join(basePath, "manifest.json");
      let manifest = { name: id, version: "0.0.0", description: "", active: false };

      if (fs.existsSync(manifestPath)) {
        try {
          manifest = { ...manifest, ...JSON.parse(fs.readFileSync(manifestPath, "utf8")) };
        } catch (err) {
          console.warn(`[plugins] manifest invalide (${id}):`, err.message);
        }
      }

      return { id, path: basePath, ...manifest };
    });
}

function loadPluginHandler(pluginsDir, pluginId) {
  const entryPath = path.join(pluginsDir, pluginId, "index.js");
  if (!fs.existsSync(entryPath)) {
    return null;
  }

  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(entryPath);
}

module.exports = { loadPlugins, loadPluginHandler };
