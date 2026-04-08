import { reactive, computed } from 'vue'
import { useRunwayJwt } from './useRunwayJwt'

// ---- Types ----

export interface RunwayUserQuota {
  activeTasks: number
  maxConcurrency: number
  dailyUsed: number
  dailyQuota: number
  totalUsed: number
  totalQuota: number
}

export interface RunwayUserPreferences {
  duration: number
  resolution: string
  quality: string
  sound: boolean
  cfgScale: number
}

// ---- Constants ----

const PREFS_KEY = 'runway_user_prefs'

const DEFAULT_PREFS: RunwayUserPreferences = {
  duration: 5,
  resolution: '1076x1920',
  quality: 'std',
  sound: false,
  cfgScale: 0.5,
}

// ---- Module-level singletons (shared across components) ----

const quota = reactive<RunwayUserQuota>({
  activeTasks: 0,
  maxConcurrency: 0,
  dailyUsed: 0,
  dailyQuota: 0,
  totalUsed: 0,
  totalQuota: 0,
})

function loadPrefs(): RunwayUserPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULT_PREFS }
}

const preferences = reactive<RunwayUserPreferences>(loadPrefs())

// ---- Composable ----

export function useRunwayUser() {
  const { token, role, username, setToken, removeToken, headers } = useRunwayJwt()

  // Auth computed
  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => role.value === 'admin')

  // Quota
  async function fetchQuota() {
    const res = await fetch('/api/runway/token-status', { headers: headers() })
    if (!res.ok) throw new Error('fetchQuota failed: HTTP ' + res.status)
    const data = await res.json()
    quota.activeTasks = data.activeTasks ?? 0
    quota.maxConcurrency = data.maxConcurrency ?? 0
    quota.dailyUsed = data.dailyUsed ?? 0
    quota.dailyQuota = data.dailyQuota ?? 0
    quota.totalUsed = data.totalUsed ?? 0
    quota.totalQuota = data.totalQuota ?? 0
  }

  const quotaDisplay = computed(() => {
    const q = quota
    return 'Today ' + q.dailyUsed + '/' + q.dailyQuota + ' \u00b7 Total ' + q.totalUsed + '/' + q.totalQuota + ' \u00b7 Active ' + q.activeTasks + '/' + q.maxConcurrency
  })

  // Preferences
  function savePreferences() {
    localStorage.setItem(PREFS_KEY, JSON.stringify(preferences))
  }

  return {
    // auth (pass-through)
    token,
    role,
    username,
    setToken,
    removeToken,
    headers,
    // auth computed
    isLoggedIn,
    isAdmin,
    // quota
    quota,
    fetchQuota,
    quotaDisplay,
    // preferences
    preferences,
    savePreferences,
  }
}
