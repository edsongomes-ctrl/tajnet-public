"use strict";

/** full = dépôt privé opérateur · public = naissance officielle (Bran Web seul, sans CV/Matomo/Futuremen) */
const EDITION = String(process.env.TAJNET_EDITION || "full").toLowerCase();
const IS_PUBLIC = EDITION === "public";

module.exports = {
  EDITION,
  IS_PUBLIC,
  IS_FULL: !IS_PUBLIC,
};
