/**
 * Version check with changelog notification.
 * On load + every 60s polls /version.json.
 * If version differs from localStorage dismissed record, triggers callback.
 */

export interface VersionInfo {
  v: string
  version: string
  changelog: string[]
}

type OnUpdate = (info: VersionInfo) => void

const DISMISSED_KEY = 'runway_dismissed_version'
let timer: ReturnType<typeof setInterval> | null = null
let onUpdateCallback: OnUpdate | null = null
let lastV: string | null = null

function getDismissed(): string | null {
  try { return localStorage.getItem(DISMISSED_KEY) } catch { return null }
}

export function dismissVersion(version: string) {
  try { localStorage.setItem(DISMISSED_KEY, version) } catch {}
}

async function checkVersion() {
  try {
    const res = await fetch('/version.json?_t=' + Date.now(), { cache: 'no-store' })
    if (!res.ok) return
    const data: VersionInfo = await res.json()

    // Prevent duplicate triggers for same build stamp
    if (lastV === data.v) return
    lastV = data.v

    // If user already dismissed this version, skip
    if (getDismissed() === data.version) return

    // Show notification
    if (onUpdateCallback) onUpdateCallback(data)
  } catch { /* silent */ }
}

export function startVersionCheck(callback: OnUpdate, intervalMs = 60_000) {
  if (timer) return
  onUpdateCallback = callback
  checkVersion()
  timer = setInterval(checkVersion, intervalMs)
}
