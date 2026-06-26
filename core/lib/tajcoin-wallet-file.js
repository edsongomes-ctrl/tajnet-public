"use strict";

const fs = require("fs");
const path = require("path");

const TAJCOIN_DATA_DIR = process.env.TAJCOIN_DATA_DIR || path.join(__dirname, "..", "..", "Tajcoin", "data");

function resolveWalletDatPath() {
  const explicit = process.env.TAJCOIN_WALLET_FILE;
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }
  const candidates = [
    path.join(TAJCOIN_DATA_DIR, "wallet.dat"),
    path.join(TAJCOIN_DATA_DIR, "wallets", "wallet.dat"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(TAJCOIN_DATA_DIR, "wallet.dat");
}

function walletDatStatus() {
  const walletPath = resolveWalletDatPath();
  if (!fs.existsSync(walletPath)) {
    return { available: false, path: walletPath, reason: "wallet.dat introuvable" };
  }
  const stat = fs.statSync(walletPath);
  return {
    available: true,
    path: walletPath,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

function readWalletDatBuffer() {
  const status = walletDatStatus();
  if (!status.available) {
    const err = new Error(status.reason || "wallet.dat introuvable");
    err.status = 404;
    throw err;
  }
  return { buffer: fs.readFileSync(status.path), path: status.path };
}

function writeWalletDatBuffer(buffer) {
  const walletPath = resolveWalletDatPath();
  const dir = path.dirname(walletPath);
  fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(walletPath)) {
    const backup = `${walletPath}.bak-${Date.now()}`;
    fs.copyFileSync(walletPath, backup);
  }

  fs.writeFileSync(walletPath, buffer);
  return { path: walletPath, sizeBytes: buffer.length };
}

module.exports = {
  resolveWalletDatPath,
  walletDatStatus,
  readWalletDatBuffer,
  writeWalletDatBuffer,
};
