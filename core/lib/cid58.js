"use strict";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(str) {
  if (!str || typeof str !== "string") {
    throw new Error("base58 invalide");
  }

  const bytes = [0];
  for (const char of str) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value < 0) {
      throw new Error("base58 invalide");
    }
    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (const char of str) {
    if (char !== "1") break;
    bytes.push(0);
  }

  return Buffer.from(bytes.reverse());
}

function base58Encode(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("buffer attendu");
  }

  const digits = [0];
  for (const byte of buffer) {
    let carry = byte;
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let prefix = "";
  for (const byte of buffer) {
    if (byte !== 0) break;
    prefix += "1";
  }

  let encoded = "";
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    encoded += BASE58_ALPHABET[digits[i]];
  }

  return prefix + encoded;
}

module.exports = { base58Decode, base58Encode };
