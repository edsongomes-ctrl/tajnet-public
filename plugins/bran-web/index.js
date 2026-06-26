"use strict";

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const PLUGIN_DIR = __dirname;

function readWorkflow() {
  const workflowPath = path.join(PLUGIN_DIR, "workflow-bran.md");
  if (!fs.existsSync(workflowPath)) {
    return null;
  }
  return fs.readFileSync(workflowPath, "utf8");
}

function writeWorkflow(content) {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Contenu workflow requis");
  }
  if (!content.trimStart().startsWith("---")) {
    throw new Error("Frontmatter YAML requis (commencer par ---)");
  }
  if (!/##\s+@bio\b/m.test(content)) {
    throw new Error("Section ## @bio manquante");
  }
  if (!/##\s+@source\b/m.test(content)) {
    throw new Error("Section ## @source manquante");
  }

  const workflowPath = path.join(PLUGIN_DIR, "workflow-bran.md");
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  fs.writeFileSync(workflowPath, normalized, "utf8");
  return readWorkflow();
}

function siteFiles() {
  const names = ["index.html", "bio.md", "source.md", "style.css", "script.js"];
  return names.map((name) => {
    const filePath = path.join(PLUGIN_DIR, name);
    return {
      name,
      exists: fs.existsSync(filePath),
      mtime: fs.existsSync(filePath) ? fs.statSync(filePath).mtime.toISOString() : null,
    };
  });
}

function status() {
  const files = siteFiles();
  return {
    active: true,
    version: "1.0.0",
    siteUrl: "/bran-web/",
    editorUrl: "/bran-web/edit.html",
    publish: {
      price: Number(process.env.BRAN_PUBLISH_PRICE_TAJ || 2),
      editorFree: true,
      previewFree: true,
    },
    workflowPresent: fs.existsSync(path.join(PLUGIN_DIR, "workflow-bran.md")),
    generated: files.every((f) => f.exists),
    files,
  };
}

async function generate({ check = false } = {}) {
  const scriptPath = path.join(PLUGIN_DIR, "generate-bran.py");
  if (!fs.existsSync(scriptPath)) {
    throw new Error("generate-bran.py introuvable");
  }
  const args = check ? ["--check"] : [];
  const { stdout, stderr } = await execFileAsync("python3", [scriptPath, ...args], {
    cwd: PLUGIN_DIR,
    timeout: 60_000,
  });
  return {
    check,
    stdout: String(stdout || "").trim(),
    stderr: String(stderr || "").trim(),
    branWeb: status(),
  };
}

module.exports = {
  PLUGIN_DIR,
  status,
  generate,
  readWorkflow,
  writeWorkflow,
  siteFiles,
};
