"use strict";

/**
 * Wallet Tajcoin MVP — navigateur uniquement, sans application à installer.
 * MetaMask / Brave Wallet : optionnel si l’extension est présente.
 */
function getEthereumProvider() {
  if (typeof window === "undefined") {
    return null;
  }
  if (window.ethereum?.providers?.length) {
    const preferred =
      window.ethereum.providers.find((p) => p.isMetaMask) ||
      window.ethereum.providers.find((p) => p.isBraveWallet) ||
      window.ethereum.providers[0];
    return preferred || window.ethereum;
  }
  return window.ethereum || window.braveEthereum || null;
}

function isLocalhostClient() {
  const host = window.location.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function isPrivateNetworkClient() {
  if (isLocalhostClient()) {
    return true;
  }
  const host = window.location.hostname.toLowerCase();
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (host.endsWith(".local")) return true;
  return false;
}

function isWanClient() {
  return !isPrivateNetworkClient();
}

function getWalletProviderLabel(provider) {
  if (!provider) {
    return null;
  }
  if (provider.isMetaMask) {
    return "MetaMask";
  }
  if (provider.isBraveWallet) {
    return "Brave Wallet";
  }
  if (provider.isRabby) {
    return "Rabby";
  }
  return "Wallet Web3";
}

if (typeof window !== "undefined") {
  window.getEthereumProvider = getEthereumProvider;
  window.isLocalhostClient = isLocalhostClient;
  window.isPrivateNetworkClient = isPrivateNetworkClient;
  window.isWanClient = isWanClient;
  window.getWalletProviderLabel = getWalletProviderLabel;
}
