"use strict";

const GUARD_STORAGE_KEY = "tajnetGuardSession";

function getGuardSessionId() {
  try {
    const raw = localStorage.getItem(GUARD_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw).sessionId || null;
  } catch {
    return null;
  }
}

function getGuardSession() {
  try {
    const raw = localStorage.getItem(GUARD_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveGuardSession(session) {
  localStorage.setItem(GUARD_STORAGE_KEY, JSON.stringify(session));
}

function clearGuardSession() {
  localStorage.removeItem(GUARD_STORAGE_KEY);
}

function isGuardSessionUnlocked() {
  const session = getGuardSession();
  if (!session || session.status !== "unlocked") return false;
  if (session.unlockedUntil && Date.now() >= session.unlockedUntil) return false;
  return true;
}

function guardSessionHeaders(extra = {}) {
  const sessionId = getGuardSessionId();
  if (!sessionId) return extra;
  return { ...extra, "X-Guard-Session": sessionId };
}

function guardRequiredMessage() {
  return "Session Guard requise — cliquez « Payer » pour déverrouiller sans quitter la page.";
}

async function refreshGuardSessionFromServer() {
  const sessionId = getGuardSessionId();
  if (!sessionId) {
    return { ok: false, reason: "missing" };
  }

  try {
    const res = await fetch(`${window.location.origin}/api/guard/session/${sessionId}`);
    if (!res.ok) {
      clearGuardSession();
      return { ok: false, reason: "expired" };
    }
    const data = await res.json();
    if (data.session) {
      saveGuardSession(data.session);
    }
    return {
      ok: true,
      unlocked: data.session?.status === "unlocked",
      session: data.session,
    };
  } catch (err) {
    return { ok: false, reason: "network", error: err };
  }
}
