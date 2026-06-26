"use strict";

const { LOCAL_PROFILE, tajcoinRpc } = require("./tajcoin");
const { getAccountAddresses } = require("./wallet-accounts");
const { addBufferToIpfs } = require("./ipfs");
const {
  createRewardEscrowAddress,
  fundRewardEscrow,
} = require("./pin-rewards");
const { buildOpReturnTransaction, selectUtxo, toSatoshis } = require("./tajcoin-tx");

const ANNOUNCE_ENABLED = process.env.ANNOUNCE_ENABLED !== "false";
const ANNOUNCE_ACCOUNT = process.env.ANNOUNCE_ACCOUNT || "tajannounce";
const ANNOUNCE_WALLET_PASSPHRASE =
  process.env.ANNOUNCE_WALLET_PASSPHRASE || process.env.TAJCOIN_WALLET_PASSPHRASE || "";
const ANNOUNCE_PIN_REWARD_TAJ = Number(process.env.ANNOUNCE_PIN_REWARD_TAJ || 0.5);
const MAX_OP_RETURN_BYTES = 40;

const ANNOUNCE_TYPES = {
  page: 0x01,
  file: 0x02,
  cv: 0x03,
};

const { base58Decode, base58Encode } = require("./cid58");

function encodeOpReturnPayload(typeCode, metadataCid) {
  if (!metadataCid.startsWith("Qm")) {
    throw new Error("Le CID metadata doit être en v0 (Qm…) pour l'OP_RETURN");
  }

  const cidBytes = base58Decode(metadataCid);
  const header = Buffer.from([0x54, 0x41, 0x4a, typeCode]); // TAJ + type
  const payload = Buffer.concat([header, cidBytes]);

  if (payload.length > MAX_OP_RETURN_BYTES) {
    throw new Error(
      `Payload OP_RETURN trop long (${payload.length} > ${MAX_OP_RETURN_BYTES} octets)`
    );
  }

  return payload;
}

function decodeOpReturnPayload(input) {
  const data = Buffer.isBuffer(input) ? input : Buffer.from(input, "hex");
  if (data.length < 4 || data[0] !== 0x54 || data[1] !== 0x41 || data[2] !== 0x4a) {
    return null;
  }

  const typeCode = data[3];
  const type = Object.entries(ANNOUNCE_TYPES).find(([, code]) => code === typeCode)?.[0] || "unknown";
  const cidBytes = data.subarray(4);
  let metadataCid = null;
  try {
    metadataCid = base58Encode(cidBytes);
  } catch {
    metadataCid = null;
  }

  return { type, typeCode, cidBytes, metadataCid, raw: data };
}

async function ensureAnnounceAccount(rpcProfile = LOCAL_PROFILE) {
  let addresses = await getAccountAddresses(ANNOUNCE_ACCOUNT, rpcProfile);
  if (!addresses.length) {
    const address = await tajcoinRpc("getnewaddress", [ANNOUNCE_ACCOUNT], rpcProfile);
    addresses = [address];
  }
  return { account: ANNOUNCE_ACCOUNT, addresses };
}

async function ensureWalletUnlocked(rpcProfile = LOCAL_PROFILE) {
  if (!ANNOUNCE_WALLET_PASSPHRASE) {
    return;
  }
  try {
    await tajcoinRpc("walletpassphrase", [ANNOUNCE_WALLET_PASSPHRASE, 60], rpcProfile);
  } catch (err) {
    if (!/unencrypted/i.test(err.message)) {
      throw err;
    }
  }
}

async function broadcastOpReturn(payload, rpcProfile = LOCAL_PROFILE) {
  const { addresses } = await ensureAnnounceAccount(rpcProfile);
  const unspent = await tajcoinRpc("listunspent", [1, 9999999, addresses], rpcProfile);

  if (!Array.isArray(unspent) || !unspent.length) {
    throw new Error(`Aucun UTXO sur le compte ${ANNOUNCE_ACCOUNT} — alimentez-le en TAJ`);
  }

  const utxo = selectUtxo(unspent, 1000);
  if (!utxo) {
    throw new Error(`UTXO du compte ${ANNOUNCE_ACCOUNT} insuffisant pour les frais`);
  }

  const { rawHex } = buildOpReturnTransaction({
    utxo,
    opReturnData: payload,
    changeAddress: utxo.address,
    scriptPubKeyHex: utxo.scriptPubKey,
  });

  await ensureWalletUnlocked(rpcProfile);

  const signed = await tajcoinRpc(
    "signrawtransaction",
    [
      rawHex,
      [
        {
          txid: utxo.txid,
          vout: utxo.vout,
          scriptPubKey: utxo.scriptPubKey,
        },
      ],
    ],
    rpcProfile
  );

  if (!signed?.complete || !signed?.hex) {
    throw new Error(signed?.errors?.[0]?.error || "Signature transaction échouée");
  }

  const txid = await tajcoinRpc("sendrawtransaction", [signed.hex], rpcProfile);
  return { txid, inputAmount: utxo.amount, changeAddress: utxo.address };
}

function buildMetadata({ type, contentCid, title, author, extra = {} }) {
  return {
    v: 1,
    protocol: "tajnet",
    type,
    contentCid,
    title: title || null,
    author: author || null,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

async function pinMetadata(metadata) {
  const buffer = Buffer.from(JSON.stringify(metadata, null, 0), "utf8");
  const result = await addBufferToIpfs(buffer, "tajnet-announce.json", { cidVersion: 0 });
  if (!result.cid?.startsWith("Qm")) {
    throw new Error("Échec génération CID metadata v0");
  }
  return result;
}

async function announcePublication({
  type,
  contentCid,
  title,
  author,
  extra = {},
  rpcProfile = LOCAL_PROFILE,
  rewardLedger = null,
  contentPool = null,
}) {
  if (!ANNOUNCE_ENABLED) {
    return { status: "skipped", reason: "ANNOUNCE_ENABLED=false" };
  }

  const typeCode = ANNOUNCE_TYPES[type];
  if (!typeCode) {
    return { status: "failed", error: `Type d'annonce inconnu: ${type}` };
  }
  if (!contentCid) {
    return { status: "failed", error: "CID contenu manquant" };
  }

  try {
    const { addresses } = await ensureAnnounceAccount(rpcProfile);
    const publisherAddress = addresses[0] || null;
    const pinRewardTaj =
      extra.pinRewardTaj != null ? Math.max(0, Number(extra.pinRewardTaj) || 0) : ANNOUNCE_PIN_REWARD_TAJ;

    let rewardEscrowAddress = null;
    if (pinRewardTaj > 0) {
      rewardEscrowAddress = await createRewardEscrowAddress(rpcProfile);
    }

    const publisherEndpoint =
      extra.publisherEndpoint || process.env.DISCOVER_NODE_ENDPOINT || null;

    const metadata = buildMetadata({
      type,
      contentCid,
      title,
      author: author || publisherAddress,
      extra: {
        ...extra,
        pinRewardTaj,
        publisherAddress,
        rewardEscrowAddress,
        publisherEndpoint,
      },
    });
    const pinned = await pinMetadata(metadata);
    const payload = encodeOpReturnPayload(typeCode, pinned.cid);
    const broadcast = await broadcastOpReturn(payload, rpcProfile);

    let rewardFund = null;
    if (pinRewardTaj > 0 && rewardEscrowAddress) {
      rewardFund = await fundRewardEscrow(
        {
          contentCid,
          rewardEscrowAddress,
          amount: pinRewardTaj,
          announceTxid: broadcast.txid,
          metadataCid: pinned.cid,
        },
        rewardLedger,
        rpcProfile,
        contentPool
      );
    }

    return {
      status: "broadcast",
      type,
      contentCid,
      metadataCid: pinned.cid,
      metadata,
      txid: broadcast.txid,
      opReturnBytes: payload.length,
      account: ANNOUNCE_ACCOUNT,
      pinRewardTaj,
      rewardEscrowAddress,
      rewardFund,
    };
  } catch (err) {
    return {
      status: "failed",
      type,
      contentCid,
      error: err.message,
    };
  }
}

function announceConfig() {
  return {
    enabled: ANNOUNCE_ENABLED,
    account: ANNOUNCE_ACCOUNT,
    maxOpReturnBytes: MAX_OP_RETURN_BYTES,
    pinRewardTaj: ANNOUNCE_PIN_REWARD_TAJ,
    types: Object.keys(ANNOUNCE_TYPES),
  };
}

async function initAnnounce(rpcProfile = LOCAL_PROFILE) {
  if (!ANNOUNCE_ENABLED) {
    return { enabled: false };
  }
  try {
    const { addresses } = await ensureAnnounceAccount(rpcProfile);
    const unspent = await tajcoinRpc("listunspent", [1, 9999999, addresses], rpcProfile);
    const balance = (unspent || []).reduce((sum, utxo) => sum + toSatoshis(utxo.amount), 0);
    return {
      enabled: true,
      account: ANNOUNCE_ACCOUNT,
      address: addresses[0],
      utxoCount: unspent?.length || 0,
      balanceSat: balance,
      balanceTaj: balance / 100_000_000,
    };
  } catch (err) {
    return { enabled: true, account: ANNOUNCE_ACCOUNT, error: err.message };
  }
}

module.exports = {
  ANNOUNCE_TYPES,
  announceConfig,
  announcePublication,
  decodeOpReturnPayload,
  encodeOpReturnPayload,
  initAnnounce,
  base58Encode,
};
