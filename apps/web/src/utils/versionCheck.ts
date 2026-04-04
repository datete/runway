/**
 * Version check with changelog notification.
 * Polls /version.json every 60s. When a new version is detected,
 * shows changelog via callback. User dismisses → version stored in localStorage → no repeat.
 */

export interface VersionInfo {
  v: string
  version: string
  changelog: string[]
}

type OnUpdate = (info: VersionInfo) => void

const DISMISSED_KEY = 'runway_dismissed_version'
let currentVersion: string | null = null
let timer: ReturnType<typeof setInterval> | null = null
let onUpdateCallback: OnUpdate | null = null

function isDismissed(version: string): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === version
  } catch { return false }
}

export function dismissVersion(version: string) {
  try { localStorage.setItem(DISMISSED_KEY, version) } catch {}
}

async function checkVersion() {
  try {
    const res = await fetch('/version.json?_t=' + Date.now(), { cache: 'no-store' })
    if (!res.ok) return
    const data: VersionInfo = await res.json()
    if (!currentVersion) {
      currentVersion = data.v
      return
    }
    if (data.v !== currentVersion) {
      currentVersion = data.v
      // Already dismissed this version? skip
      if (isDismissed(data.version)) return
      if (onUpdateCallback) onUpdateCallback(data)
    }
  } catch { /* silent */ }
}

export function startVersionCheck(callback: OnUpdate, intervalMs = 60_000) {
  if (timer) return
  onUpdateCallback = callback
  checkVersion()
  timer = setInterval(checkVersion, intervalMs)
}
