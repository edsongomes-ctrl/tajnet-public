"use strict";

const state = {
  mode: "metamask",
  balance: 0,
  tajcoinAddress: null,
  allAddresses: [],
  transactions: [],
  blockHeight: 0,
  rpcProfile: null,
};

function showToast(message, ok = true) {
  const el = document.createElement("div");
  el.className = `toast ${ok ? "ok" : "err"}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function truncateAddress(addr) {
  if (!addr || addr.length < 12) return addr || "";
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function formatAmount(value) {
  return `${Number(value || 0).toFixed(4)} TAJ`;
}

function setActiveTab(name) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === name);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${name}`);
  });
}

function renderTransactions() {
  const list = document.getElementById("txList");
  if (!state.transactions.length) {
    list.innerHTML = "<li class='tx-meta'>Aucune transaction</li>";
    return;
  }

  list.innerHTML = state.transactions
    .slice()
    .reverse()
    .map((tx) => {
      const isSend = tx.category === "send";
      const cls = isSend ? "tx-send" : "tx-receive";
      const sign = isSend ? "−" : "+";
      const amount = Math.abs(Number(tx.amount || 0));
      return `<li class="tx-item">
        <div>
          <div class="${cls}">${isSend ? "Envoi" : "Réception"} — ${sign}${amount.toFixed(4)} TAJ</div>
          <div class="tx-meta">${tx.address ? truncateAddress(tx.address) : ""} · ${tx.confirmations || 0} conf.</div>
        </div>
        <div class="tx-meta">${tx.txid ? truncateAddress(tx.txid) : ""}</div>
      </li>`;
    })
    .join("");
}

function updateReceiveQr() {
  const container = document.getElementById("qrCode");
  container.innerHTML = "";
  if (state.tajcoinAddress && window.QRCode) {
    new QRCode(container, {
      text: state.tajcoinAddress,
      width: 180,
      height: 180,
    });
  }
}

function updateUi() {
  document.getElementById("balanceValue").textContent = formatAmount(state.balance);
  document.getElementById("receiveAddress").textContent = state.tajcoinAddress || "—";
  document.getElementById("blockHeight").textContent = state.blockHeight || "—";
  document.getElementById("addressCount").textContent = state.allAddresses.length;

  const fromSelect = document.getElementById("fromAddress");
  fromSelect.innerHTML = state.allAddresses
    .map(
      (addr) =>
        `<option value="${addr}" ${addr === state.tajcoinAddress ? "selected" : ""}>${truncateAddress(addr)}</option>`
    )
    .join("");

  const ethEl = document.getElementById("ethAddress");
  if (ethEl) {
    ethEl.textContent = state.ethereumAddress
      ? truncateAddress(state.ethereumAddress)
      : "Wallet nœud local";
  }

  const rpcEl = document.getElementById("rpcLabel");
  if (rpcEl && state.rpcProfile) {
    const endpoint = state.rpcProfile.url || state.rpcProfile.endpoint || state.rpcProfile.id;
    rpcEl.textContent = `RPC : ${state.rpcProfile.label || state.rpcProfile.id}${endpoint ? ` (${endpoint})` : ""}`;
  }

  renderTransactions();
  updateReceiveQr();
}

async function loadMetamaskWallet(silent = false) {
  if (!silent) {
    document.getElementById("refreshBtn").disabled = true;
  }

  try {
    const data = await tajCoinAuth.getWalletData();
    state.mode = "metamask";
    state.balance = data.balance;
    state.tajcoinAddress = data.tajcoinAddress;
    state.allAddresses = data.allAddresses || [];
    state.transactions = data.transactions || [];
    state.blockHeight = data.blockHeight;
    state.ethereumAddress = data.ethereumAddress;
    state.rpcProfile = data.rpcProfile;
    updateUi();
  } catch (err) {
    if (!silent) {
      showToast(err.message, false);
    }
    if (String(err.message).includes("Session")) {
      window.location.href = "/wallet/login.html";
    }
  } finally {
    document.getElementById("refreshBtn").disabled = false;
  }
}

async function loadLocalWallet(silent = false) {
  if (!silent) {
    document.getElementById("refreshBtn").disabled = true;
  }

  try {
    const rpc = tajCoinAuth.loadRpcProfile();
    const res = await fetch("/api/wallet/local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rpc }),
    });
    const data = await res.json();
    if (res.status === 403) {
      window.location.href = "/wallet/login.html";
      return;
    }
    if (!res.ok) {
      throw new Error(data.error || "Wallet local indisponible");
    }

    state.mode = "local";
    state.balance = data.balance;
    state.tajcoinAddress = data.tajcoinAddress;
    state.allAddresses = data.allAddresses || [];
    state.transactions = data.transactions || [];
    state.blockHeight = data.nodeInfo?.blocks || 0;
    state.ethereumAddress = null;
    state.rpcProfile = data.rpcProfile || rpc;
    updateUi();
  } catch (err) {
    if (!silent) {
      showToast(err.message, false);
    }
  } finally {
    document.getElementById("refreshBtn").disabled = false;
  }
}

async function loadWalletData(silent = false) {
  const session = tajCoinAuth.restoreSession();
  if (session?.sessionId) {
    await loadMetamaskWallet(silent);
  } else if (isLocalhostClient()) {
    await loadLocalWallet(silent);
  } else if (!silent) {
    showToast("Connexion MetaMask requise depuis le LAN", false);
    window.location.href = "/wallet/login.html";
  }
}

async function handleSend(event) {
  event.preventDefault();

  const toAddress = document.getElementById("toAddress").value.trim();
  const amount = Number(document.getElementById("amount").value);
  const comment = document.getElementById("comment").value.trim();
  const fromAddress = document.getElementById("fromAddress").value;

  if (!toAddress || !Number.isFinite(amount) || amount <= 0) {
    showToast("Destinataire et montant requis", false);
    return;
  }

  if (state.mode === "local") {
    showToast("Envoi réservé au wallet personnel Web3 — connectez-vous sur /wallet/login", false);
    return;
  }

  try {
    const result = await tajCoinAuth.send({ toAddress, amount, fromAddress, comment });
    showToast(`Transaction envoyée : ${truncateAddress(result.txid)}`);
    document.getElementById("sendForm").reset();
    await loadWalletData();
  } catch (err) {
    showToast(err.message, false);
  }
}

async function copyAddress() {
  if (!state.tajcoinAddress) return;
  await navigator.clipboard.writeText(state.tajcoinAddress);
  showToast("Adresse copiée");
}

async function generateNewAddress() {
  if (state.mode === "local") {
    showToast("Nouvelle adresse : connectez un wallet Web3", false);
    return;
  }

  try {
    const data = await tajCoinAuth.newAddress();
    state.allAddresses = data.allAddresses;
    state.tajcoinAddress = data.address;
    updateUi();
    showToast("Nouvelle adresse générée");
  } catch (err) {
    showToast(err.message, false);
  }
}

async function handleLogout() {
  if (state.mode === "metamask") {
    await tajCoinAuth.logout();
  }
  window.location.href = "/wallet/login.html";
}

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setActiveTab(tab.dataset.tab));
  });

  document.getElementById("refreshBtn").addEventListener("click", () => loadWalletData());
  document.getElementById("copyAddressBtn").addEventListener("click", copyAddress);
  document.getElementById("newAddressBtn").addEventListener("click", generateNewAddress);
  document.getElementById("sendForm").addEventListener("submit", handleSend);
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);

  const session = tajCoinAuth.restoreSession();
  if (!session?.sessionId) {
    const params = new URLSearchParams(window.location.search);
    const wantsLocal = params.get("mode") === "local";
    if (!isLocalhostClient() || !wantsLocal) {
      window.location.href = "/wallet/login.html";
      return;
    }
  }

  await loadWalletData();
  setInterval(() => loadWalletData(true), 30000);
});
