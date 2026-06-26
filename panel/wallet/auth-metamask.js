/**
 * Auth MetaMask → TajCoin + sélection RPC (adapté TajNet)
 */
class MetaMaskTajCoinAuth {
  constructor() {
    this.ethereumAddress = null;
    this.sessionId = null;
    this.tajcoinAddress = null;
    this.accountName = null;
    this.rpcProfile = { id: "local" };
    this.serverUrl = window.location.origin;
  }

  loadRpcProfile() {
    try {
      const raw = localStorage.getItem("tajnetWalletRpc");
      if (!raw) {
        return { id: "local" };
      }
      return JSON.parse(raw);
    } catch {
      return { id: "local" };
    }
  }

  saveRpcProfile(profile) {
    this.rpcProfile = profile;
    localStorage.setItem("tajnetWalletRpc", JSON.stringify(profile));
  }

  getRpcPayload() {
    const profile = this.loadRpcProfile();
    this.rpcProfile = profile;
    return { rpc: profile };
  }

  async api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    if (this.sessionId) {
      headers["X-Wallet-Session"] = this.sessionId;
    }

    const fetchOptions = { ...options, headers };
    if (options.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const res = await fetch(`${this.serverUrl}${path}`, fetchOptions);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Erreur HTTP ${res.status}`);
    }
    return data;
  }

  async fetchProfiles() {
    const data = await this.api("/api/wallet/rpc/profiles", { method: "GET" });
    return data.profiles || [];
  }

  async testRpc(profile) {
    return this.api("/api/wallet/rpc/test", {
      method: "POST",
      body: { rpc: profile },
    });
  }

  async signAuthMessage(action) {
    const provider = typeof getEthereumProvider === "function" ? getEthereumProvider() : window.ethereum;
    if (!provider) {
      throw new Error(
        typeof walletUnavailableMessage === "function"
          ? walletUnavailableMessage()
          : "MetaMask ou Rabby requis"
      );
    }

    const accounts = await provider.request({ method: "eth_requestAccounts" });
    this.ethereumAddress = accounts[0];

    const timestamp = Date.now();
    const message = `TajNet Wallet ${action}\n\nAddress: ${this.ethereumAddress}\nTimestamp: ${timestamp}\n\nCette signature prouve que vous possédez cette adresse Ethereum.`;

    const signature = await provider.request({
      method: "personal_sign",
      params: [message, this.ethereumAddress],
    });

    return { message, signature, timestamp };
  }

  saveSession(data) {
    this.sessionId = data.sessionId;
    this.accountName = data.accountName;
    this.tajcoinAddress = data.tajcoinAddress;
    if (data.rpcProfile) {
      this.saveRpcProfile(data.rpcProfile);
    }
    localStorage.setItem(
      "tajnetWalletSession",
      JSON.stringify({
        sessionId: data.sessionId,
        ethereumAddress: this.ethereumAddress,
        tajcoinAddress: data.tajcoinAddress,
        accountName: data.accountName,
        rpcProfile: data.rpcProfile || this.loadRpcProfile(),
      })
    );
  }

  restoreSession() {
    const raw = localStorage.getItem("tajnetWalletSession");
    if (!raw) {
      return null;
    }
    try {
      const data = JSON.parse(raw);
      this.sessionId = data.sessionId;
      this.ethereumAddress = data.ethereumAddress;
      this.tajcoinAddress = data.tajcoinAddress;
      this.accountName = data.accountName;
      if (data.rpcProfile) {
        this.saveRpcProfile(data.rpcProfile);
      }
      return data;
    } catch {
      return null;
    }
  }

  clearSession() {
    this.sessionId = null;
    localStorage.removeItem("tajnetWalletSession");
  }

  authBody(extra = {}) {
    return {
      ethereumAddress: this.ethereumAddress,
      ...extra,
      ...this.getRpcPayload(),
    };
  }

  async checkWallet() {
    const signed = await this.signAuthMessage("Check");
    return this.api("/api/wallet/auth/check-wallet", {
      method: "POST",
      body: this.authBody(signed),
    });
  }

  async createWallet() {
    const signed = await this.signAuthMessage("Create");
    const data = await this.api("/api/wallet/auth/create-wallet", {
      method: "POST",
      body: this.authBody(signed),
    });
    this.saveSession(data);
    return data;
  }

  async login() {
    const signed = await this.signAuthMessage("Login");
    const data = await this.api("/api/wallet/auth/login", {
      method: "POST",
      body: this.authBody(signed),
    });
    this.saveSession(data);
    return data;
  }

  async logout() {
    try {
      await this.api("/api/wallet/auth/logout", { method: "POST", body: {} });
    } finally {
      this.clearSession();
    }
  }

  async getWalletData() {
    return this.api("/api/wallet/data", { method: "GET" });
  }

  async newAddress() {
    return this.api("/api/wallet/new-address", { method: "POST", body: {} });
  }

  async send({ toAddress, amount, fromAddress, comment }) {
    return this.api("/api/wallet/send", {
      method: "POST",
      body: { toAddress, amount, fromAddress, comment },
    });
  }
}

const tajCoinAuth = new MetaMaskTajCoinAuth();
