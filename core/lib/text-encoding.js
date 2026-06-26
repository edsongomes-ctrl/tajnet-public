"use strict";

/** Texte UTF-8 interprété à tort en Latin-1 (ex. « annoncÃ© »). */
function looksLikeUtf8Mojibake(text) {
  return /(?:Ã.|Â.|â€[™œž]|[\u00C2-\u00C3][\u0080-\u00BF])/.test(text);
}

function repairUtf8Mojibake(text) {
  if (!text || typeof text !== "string") {
    return text;
  }

  let out = text;
  for (let i = 0; i < 2; i += 1) {
    if (!looksLikeUtf8Mojibake(out)) {
      break;
    }
    const next = Buffer.from(out, "latin1").toString("utf8");
    if (!next || next === out || next.includes("\uFFFD")) {
      break;
    }
    out = next;
  }
  return out;
}

function bufferToUnicodeText(buffer) {
  if (!buffer?.length) {
    return "";
  }

  const utf8 = buffer.toString("utf8").trim();
  const utf8Bytes = Buffer.from(utf8, "utf8");
  const utf8Valid = !utf8.includes("\uFFFD") && utf8Bytes.equals(buffer);

  if (utf8Valid) {
    return repairUtf8Mojibake(utf8);
  }

  if (utf8 && !utf8.includes("\uFFFD")) {
    return repairUtf8Mojibake(utf8);
  }

  const latin1 = buffer.toString("latin1").trim();
  return repairUtf8Mojibake(latin1 || utf8);
}

function normalizeUnicodeText(value) {
  if (value == null || typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  return repairUtf8Mojibake(trimmed);
}

function normalizeDiscoverTextFields(entry) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }

  if (entry.title) {
    entry.title = normalizeUnicodeText(entry.title);
  }

  if (Array.isArray(entry.tags)) {
    entry.tags = entry.tags.map((tag) => normalizeUnicodeText(tag));
  }

  if (entry.metadata && typeof entry.metadata === "object") {
    if (entry.metadata.title) {
      entry.metadata.title = normalizeUnicodeText(entry.metadata.title);
    }
    if (entry.metadata.description) {
      entry.metadata.description = normalizeUnicodeText(entry.metadata.description);
    }
    if (Array.isArray(entry.metadata.tags)) {
      entry.metadata.tags = entry.metadata.tags.map((tag) => normalizeUnicodeText(tag));
    }
  }

  return entry;
}

module.exports = {
  looksLikeUtf8Mojibake,
  repairUtf8Mojibake,
  bufferToUnicodeText,
  normalizeUnicodeText,
  normalizeDiscoverTextFields,
};
