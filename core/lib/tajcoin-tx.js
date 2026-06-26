"use strict";

const COIN = 100_000_000;
const MIN_TX_FEE = 100;
const DUST_THRESHOLD = 546 * MIN_TX_FEE;
const TX_VERSION = 1;
/** Tajcoin rejette les sorties vout.nValue === 0 (y compris OP_RETURN) — minimum 1 satoshi. */
const OP_RETURN_OUTPUT_VALUE = 1;

function writeUInt32LE(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}

function writeUInt64LE(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value), 0);
  return buf;
}

function writeVarInt(value) {
  if (value < 0xfd) {
    return Buffer.from([value]);
  }
  if (value <= 0xffff) {
    const buf = Buffer.alloc(3);
    buf[0] = 0xfd;
    buf.writeUInt16LE(value, 1);
    return buf;
  }
  if (value <= 0xffffffff) {
    const buf = Buffer.alloc(5);
    buf[0] = 0xfe;
    buf.writeUInt32LE(value, 1);
    return buf;
  }
  const buf = Buffer.alloc(9);
  buf[0] = 0xff;
  buf.writeBigUInt64LE(BigInt(value), 1);
  return buf;
}

function reverseHex(hex) {
  return Buffer.from(hex, "hex").reverse();
}

function toSatoshis(amount) {
  return Math.round(Number(amount) * COIN);
}

function buildOpReturnScript(data) {
  if (!Buffer.isBuffer(data)) {
    throw new Error("OP_RETURN data must be a buffer");
  }
  if (data.length > 40) {
    throw new Error(`OP_RETURN max 40 bytes (reçu ${data.length})`);
  }
  return Buffer.concat([Buffer.from([0x6a, data.length]), data]);
}

function serializeTransaction({ nTime, inputs, outputs, lockTime = 0 }) {
  const chunks = [
    writeUInt32LE(TX_VERSION),
    writeUInt32LE(nTime),
    writeVarInt(inputs.length),
  ];

  for (const input of inputs) {
    chunks.push(reverseHex(input.txid));
    chunks.push(writeUInt32LE(input.vout));
    const scriptSig = input.scriptSig || Buffer.alloc(0);
    chunks.push(writeVarInt(scriptSig.length));
    chunks.push(scriptSig);
    chunks.push(writeUInt32LE(input.sequence ?? 0xffffffff));
  }

  chunks.push(writeVarInt(outputs.length));
  for (const output of outputs) {
    chunks.push(writeUInt64LE(output.value));
    chunks.push(writeVarInt(output.scriptPubKey.length));
    chunks.push(output.scriptPubKey);
  }

  chunks.push(writeUInt32LE(lockTime));
  return Buffer.concat(chunks);
}

function selectUtxo(unspent, feeSat) {
  const sorted = [...unspent].sort((a, b) => toSatoshis(a.amount) - toSatoshis(b.amount));
  return sorted.find((utxo) => toSatoshis(utxo.amount) > feeSat + DUST_THRESHOLD) || null;
}

function buildOpReturnTransaction({ utxo, opReturnData, changeAddress, scriptPubKeyHex, feeSat = MIN_TX_FEE }) {
  const inputSat = toSatoshis(utxo.amount);
  const opReturnValue = OP_RETURN_OUTPUT_VALUE;
  if (inputSat <= feeSat + opReturnValue) {
    throw new Error("UTXO insuffisant pour les frais de transaction");
  }

  const opReturnScript = buildOpReturnScript(opReturnData);
  const changeScript = Buffer.from(scriptPubKeyHex, "hex");
  const outputs = [{ value: opReturnValue, scriptPubKey: opReturnScript }];

  let changeSat = inputSat - feeSat - opReturnValue;
  if (changeAddress && changeSat > DUST_THRESHOLD) {
    outputs.push({ value: changeSat, scriptPubKey: changeScript });
  } else {
    changeSat = 0;
  }

  const raw = serializeTransaction({
    nTime: Math.floor(Date.now() / 1000),
    inputs: [{ txid: utxo.txid, vout: utxo.vout }],
    outputs,
  });

  const actualFee = inputSat - opReturnValue - changeSat;

  return {
    rawHex: raw.toString("hex"),
    feeSat: actualFee,
    changeSat,
  };
}

module.exports = {
  COIN,
  MIN_TX_FEE,
  DUST_THRESHOLD,
  toSatoshis,
  buildOpReturnScript,
  serializeTransaction,
  selectUtxo,
  OP_RETURN_OUTPUT_VALUE,
  buildOpReturnTransaction,
};
