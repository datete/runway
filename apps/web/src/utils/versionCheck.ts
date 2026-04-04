/**
 * Auto-refresh when a new frontend build is deployed.
 * After each build, a /version.json with { "v": "<timestamp>" } is written.
 * This module polls it every 60s and reloads when it changes.
 */
let currentVersion: string | null = null
let timer: ReturnType<typeof setInterval> | null = null

async function checkVersion() {
  try {
    const res = await fetch("/version.json?_t=" + Date.now(), { cache: "no-store" })
    if (!res.ok) return
    const data = await res.json()
    if (!currentVersion) {
      currentVersion = data.v
      return
    }
    if (data.v !== currentVersion) {
      console.log("[version] New build detected, reloading...")
      currentVersion = data.v
      window.location.reload()
    }
  } catch { /* silent */ }
}

export function startVersionCheck(intervalMs = 60_000) {
  if (timer) return
  checkVersion()
  timer = setInterval(checkVersion, intervalMs)
}
