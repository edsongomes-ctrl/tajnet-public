"use strict";

const statusBox = document.getElementById("statusBox");
const rpcStatus = document.getElementById("rpcStatus");
const rpcProfileSelect = document.getElementById("rpcProfile");
const customRpcFields = document.getElementById("customRpcFields");
const personalWalletPanel = document.getElementById("personalWalletPanel");
const personalWalletHint = document.getElementById("personalWalletHint");
const personalWalletTitle = document.getElementById("personalWalletTitle");
const nodeWalletSection = document.getElementById("nodeWalletSection");
const loginIntro = document.getElementById("loginIntro");
const connectBtn = document.getElementById("connectBtn");
const createBtn = document.getElementById("createBtn");

function showStatus(message, ok = true) {
  statusBox.classList.remove("hidden");
  statusBox.style.borderColor = ok ? "#00ff41" : "#ff4444";
  statusBox.textContent = message;
}

function showRpcStatus(message, ok = true) {
  rpcStatus.classList.remove("hidden");
  rpcStatus.className = `rpc-status ${ok ? "ok" : "err"}`;
  rpcStatus.textContent = message;
}

function readCustomRpcFields() {
  return {
    id: "custom",
    url: document.getElementById("rpcUrl").value.trim(),
    username: document.getElementById("rpcUser").value.trim(),
    password: document.getElementById("rpcPassword").value,
  };
}

function readSelectedRpcProfile() {
  const id = rpcProfileSelect.value;
  if (id === "custom") {
    return readCustomRpcFields();
  }
  return { id };
}

function restoreRpcForm() {
  const saved = tajCoinAuth.loadRpcProfile();
  if (saved.id) {
    rpcProfileSelect.value = saved.id;
  }
  if (saved.id === "custom") {
    document.getElementById("rpcUrl").value = saved.url || "";
    document.getElementById("rpcUser").value = saved.username || "";
    document.getElementById("rpcPassword").value = saved.password || "";
  }
  toggleCustomFields();
}

function toggleCustomFields() {
  const isCustom = rpcProfileSelect.value === "custom";
  customRpcFields.classList.toggle("hidden", !isCustom);
}

function setupWalletAccess() {
  const localhost = isLocalhostClient();
  const provider = getEthereumProvider();
  const label = provider ? getWalletProviderLabel(provider) : "MetaMask";

  if (localhost) {
    nodeWalletSection?.classList.remove("hidden");
    if (loginIntro) {
      loginIntro.textContent =
        "Sur localhost : wallet nœud (tajpanel) ou wallet personnel via MetaMask / Brave.";
    }
    if (personalWalletTitle) {
      personalWalletTitle.textContent = "Wallet personnel (optionnel)";
    }
    if (personalWalletHint && provider) {
      personalWalletHint.textContent = `${label} détecté — compte Tajcoin personnel (envoi depuis votre adresse).`;
    }
  } else {
    nodeWalletSection?.classList.add("hidden");
    const remoteLabel = typeof isWanClient === "function" && isWanClient() ? "Internet" : "LAN";
    if (loginIntro) {
      loginIntro.textContent =
        `Depuis ${remoteLabel === "Internet" ? "l'" : "le "}${remoteLabel}, le wallet nœud est protégé. Connectez MetaMask pour accéder à votre compte Tajcoin.`;
    }
    if (personalWalletTitle) {
      personalWalletTitle.textContent = "Connexion requise";
    }
    if (personalWalletHint) {
      personalWalletHint.textContent = provider
        ? `${label} détecté — signez pour lier votre compte Tajcoin sur ce nœud.`
        : remoteLabel === "Internet"
          ? "Installez MetaMask sur un poste de confiance. L'administration du nœud se fait via tunnel SSH vers localhost."
          : "Installez MetaMask ou Brave Wallet sur ce poste (extension navigateur). Sur mobile sans extension, utilisez un tunnel SSH vers localhost.";
    }
    if (!provider) {
      connectBtn.disabled = true;
      createBtn.disabled = true;
      showStatus(
        `Wallet Web3 non détecté — depuis ${remoteLabel === "Internet" ? "l'" : "le "}${remoteLabel}, MetaMask est obligatoire (le wallet nœud n'est pas accessible).`,
        false
      );
    }
  }

  if (provider) {
    connectBtn.textContent = `Connecter ${label}`;
    createBtn.textContent = `Créer un wallet (${label})`;
    connectBtn.disabled = false;
    createBtn.disabled = false;
  }
}

async function loadProfiles() {
  const profiles = await tajCoinAuth.fetchProfiles();
  rpcProfileSelect.innerHTML = profiles
    .map((p) => `<option value="${p.id}">${p.label}${p.endpoint ? ` — ${p.endpoint}` : ""}</option>`)
    .join("");
  restoreRpcForm();
}

async function connectPersonalWallet({ createIfMissing = false } = {}) {
  if (!getEthereumProvider()) {
    showStatus(
      "MetaMask ou Brave Wallet requis — le wallet nœud n'est pas accessible depuis le LAN.",
      false
    );
    return;
  }

  tajCoinAuth.saveRpcProfile(readSelectedRpcProfile());
  showStatus(createIfMissing ? "Création du wallet…" : "Connexion MetaMask…");

  if (createIfMissing) {
    const check = await tajCoinAuth.checkWallet();
    if (check.walletExists) {
      await tajCoinAuth.login();
    } else {
      await tajCoinAuth.createWallet();
    }
  } else {
    await tajCoinAuth.login();
  }

  showStatus("Connexion réussie — redirection…");
  window.location.href = "/wallet/";
}

document.getElementById("rpcProfile").addEventListener("change", () => {
  toggleCustomFields();
  tajCoinAuth.saveRpcProfile(readSelectedRpcProfile());
});

document.getElementById("testRpcBtn").addEventListener("click", async () => {
  try {
    const profile = readSelectedRpcProfile();
    tajCoinAuth.saveRpcProfile(profile);
    showRpcStatus("Test RPC en cours…");
    const result = await tajCoinAuth.testRpc(profile);
    showRpcStatus(
      `Connecté — ${result.endpoint} · ${result.blocks} blocs · v${result.version || "?"}`,
      true
    );
  } catch (err) {
    showRpcStatus(err.message, false);
  }
});

document.getElementById("nodeBtn").addEventListener("click", () => {
  if (!isLocalhostClient()) {
    showStatus("Wallet nœud réservé à localhost", false);
    return;
  }
  tajCoinAuth.saveRpcProfile(readSelectedRpcProfile());
  window.location.href = "/wallet/?mode=local";
});

connectBtn.addEventListener("click", async () => {
  try {
    await connectPersonalWallet({ createIfMissing: false });
  } catch (err) {
    showStatus(err.message, false);
  }
});

createBtn.addEventListener("click", async () => {
  try {
    await connectPersonalWallet({ createIfMissing: true });
  } catch (err) {
    showStatus(err.message, false);
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  setupWalletAccess();

  try {
    await loadProfiles();
  } catch (err) {
    showRpcStatus(`Impossible de charger les profils RPC : ${err.message}`, false);
  }
});
