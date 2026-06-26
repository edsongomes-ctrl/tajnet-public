"use strict";

async function refreshStatus() {
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  try {
    const res = await fetch("/api/status", { headers: { Accept: "application/json" } });
    const data = await res.json();
    const online = data.status === "online";
    dot?.classList.toggle("online", online);
    dot?.classList.toggle("degraded", !online);
    if (text) {
      text.textContent = TajI18n.t(online ? "status.online" : "status.degraded");
    }
  } catch {
    dot?.classList.add("degraded");
    if (text) text.textContent = TajI18n.t("status.degraded");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await TajI18n.initI18n({ langSelectId: "langSelect" });
  await refreshStatus();
  setInterval(refreshStatus, 30000);
});
