<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, watch } from 'vue'

import {
  NButton, NDataTable, NDrawer, NDrawerContent, NForm, NFormItem,
  NInput, NInputNumber, NModal, NPagination, NProgress, NSelect,
  NSlider, NSwitch, NTabPane, NTabs, NTag, NTooltip, useMessage,
} from 'naive-ui'
import { useRunwayJwt } from '@/composables/useRunwayJwt'
import { SvgIcon } from '@/components/common'

/* ── Interfaces ── */
interface AdminUser {
  id: string; username: string; role: 'admin' | 'user'
  isActive: boolean; maxConcurrency: number | null
  dailyQuota: number | null; totalQuota: number | null; createdAt: string
}
interface AdminJob {
  id: string; status: string; prompt: string; duration: number | null
  createdAt: string; user?: { id: string; username: string }
  account?: { id: string; label: string; tokenShort: string }
}
interface AdminLog {
  id: string; action: string; detail: string; ip: string
  createdAt: string; user?: { id: string; username: string }
}
interface UserStat {
  id: string; username: string; role: string; isActive: boolean
  maxConcurrency: number | null; dailyQuota: number | null; totalQuota: number | null
  totalJobs: number; todayJobs: number; todayCompleted: number; todayFailed: number; currentActive: number; hourlyCompleted: number
}
interface DashboardOverview {
  totalUsers: number; activeUsers: number; totalJobs: number; todayJobs: number
  queuedJobs: number; processingJobs: number; completedJobs: number; failedJobs: number
  todayCompleted: number; todayFailed: number; hourlyCompleted: number
  totalAccounts: number; activeAccounts: number; totalMaxConcurrency: number; totalCurrentConcurrency: number
  speedMultiplier?: number
}
interface AccountInfo {
  id: string; label: string; tokenShort: string; teamId: string; proxyUrl: string | null; proxyId: string | null
  maxConcurrency: number; currentConcurrency: number; isActive: boolean; priority: number
  inCooldown: boolean; batchResting: boolean; batchRestTtl: number; batchCount: number; batchLimit: number
  totalGenerated: number; hourlyGenerated: number; lastUsedAt: string | null
  lastErrorAt: string | null; lastErrorMessage: string | null
  tokenExpiresAt: string | null; createdAt: string ; activeTasks?: ActiveTask[]
}
interface ActiveTask {
  jobId: string; username: string; status: string; progress: number; prompt: string; referenceImages: string | null; thumbnailUrl: string | null; videoUrl: string | null; createdAt: string
}

/* helper: parse task ref images */
const parseTaskImages = (task: ActiveTask): string[] => {
  if (!task.referenceImages) return []
  try {
    const parsed = typeof task.referenceImages === "string" ? JSON.parse(task.referenceImages) : task.referenceImages
    if (Array.isArray(parsed)) return parsed.filter((s: any) => typeof s === "string" && s.length > 0)
  } catch {}
  return []
}
const getTaskThumb = (task: ActiveTask): string | null => {
  if (task.thumbnailUrl) return task.thumbnailUrl
  const imgs = parseTaskImages(task)
  return imgs.length > 0 ? imgs[0] : null
}
interface AccountStat {
  id: string; label: string; tokenShort: string; isActive: boolean
  maxConcurrency: number; currentConcurrency: number; totalGenerated: number; hourlyGenerated: number; activeTasks?: ActiveTask[]
}

interface DeviceInfo {
  id: string; userId: string; fingerprint: string; deviceName: string; browser: string; os: string
  firstSeenAt: string; lastSeenAt: string; lastIp: string; isTrusted: boolean; isBlocked: boolean
  user?: { username: string }
}
interface LoginSessionInfo {
  id: string; userId: string; deviceId: string | null; ip: string; city: string | null; region: string | null
  country: string | null; userAgent: string; isSuspicious: boolean; suspiciousReason: string | null
  createdAt: string; user?: { username: string }
}

/* ── Props / Emits ── */
const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [v: boolean] }>()

const message = useMessage()
const { headers } = useRunwayJwt()

/* ── State ── */
const overview = ref<DashboardOverview>({ totalUsers: 0, activeUsers: 0, totalJobs: 0, todayJobs: 0, queuedJobs: 0, processingJobs: 0, completedJobs: 0, failedJobs: 0, todayCompleted: 0, todayFailed: 0, hourlyCompleted: 0, totalAccounts: 0, activeAccounts: 0, totalMaxConcurrency: 0, totalCurrentConcurrency: 0, speedMultiplier: 1.0 })

/* ── Global speed multiplier ── */
// UI value is percent (10..200); backend value is float (0.1..2.0)
const speedPct = ref<number>(100)
const speedSyncing = ref(false)
let speedDebounceTimer: ReturnType<typeof setTimeout> | null = null
let speedSuppressFromServer = false
const speedColorClass = computed(() => {
  const p = speedPct.value
  if (p < 50) return 'speed-zone-slow'
  if (p <= 120) return 'speed-zone-normal'
  if (p <= 160) return 'speed-zone-fast'
  return 'speed-zone-extreme'
})
const speedZoneLabel = computed(() => {
  const p = speedPct.value
  if (p < 50) return '慢'
  if (p <= 120) return '正常'
  if (p <= 160) return '快'
  return '激进'
})
const isDefaultSpeed = computed(() => speedPct.value === 100)
const pushSpeed = async (pct: number) => {
  const mult = Math.max(0.1, Math.min(2.0, Math.round(pct) / 100))
  try {
    speedSyncing.value = true
    const res = await fetch('/api/runway/admin/speed', {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ multiplier: mult }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      message.error(err.error || '更新失败')
      return
    }
    const data = await res.json()
    message.success(`已更新: ${data.multiplier}x`)
  } catch (e: any) {
    message.error(e.message || '网络错误')
  } finally {
    speedSyncing.value = false
  }
}
const onSpeedChange = (v: number) => {
  speedPct.value = v
  if (speedSuppressFromServer) return
  if (speedDebounceTimer) clearTimeout(speedDebounceTimer)
  speedDebounceTimer = setTimeout(() => { pushSpeed(v) }, 300)
}
const setSpeedPreset = (v: number) => {
  speedPct.value = v
  if (speedDebounceTimer) clearTimeout(speedDebounceTimer)
  pushSpeed(v)
}
const userStats = ref<UserStat[]>([])
const accountStatsData = ref<AccountStat[]>([])

const users = ref<AdminUser[]>([])
const userLoading = ref(false)
const showUserModal = ref(false)
const editingUser = ref<AdminUser | null>(null)
const userSaving = ref(false)
const userForm = ref({ username: '', password: '', role: 'user' as 'admin' | 'user', isActive: true, maxConcurrency: null as number | null, dailyQuota: null as number | null, totalQuota: null as number | null })

const accounts = ref<AccountInfo[]>([])
const accountsLoading = ref(false)
const showAccountModal = ref(false)
const editingAccount = ref<AccountInfo | null>(null)
const accountSaving = ref(false)
const accountForm = ref({ label: '', token: '', teamId: '', proxyId: '', proxyUrl: '', maxConcurrency: 2, priority: 0 })
const accountTesting = ref<string | null>(null)
const proxies = ref<ProxyInfo[]>([])
const proxiesLoading = ref(false)
const proxyTesting = ref<string | null>(null)
const showProxyModal = ref(false)
const editingProxy = ref<ProxyInfo | null>(null)
const proxyForm = ref({ label: '', url: '', isActive: true })
const proxySaving = ref(false)
const accountModalTab = ref<'manual' | 'login'>('login')
const loginForm = ref({ email: '', password: '', proxyUrl: '' })
const loginLoading = ref(false)

const adminJobs = ref<AdminJob[]>([])
const adminJobsTotal = ref(0)
const jobsLoading = ref(false)
const jobsPage = ref(1)
const jobsStatus = ref('')
const jobsUser = ref('')

const logs = ref<AdminLog[]>([])
const logsTotal = ref(0)
const logsLoading = ref(false)
const logsPage = ref(1)
const logsAction = ref('')

const devices = ref<DeviceInfo[]>([])
const devicesLoading = ref(false)
const suspiciousSessions = ref<LoginSessionInfo[]>([])
const sessionsLoading = ref(false)

/* ── API Keys state ── */
interface ApiKeyInfo {
  id: string; name: string; prefix: string; userId: string; username: string
  rateLimit: number; enabled: boolean; lastUsedAt: string | null
  expiresAt: string | null; createdAt: string
}
const apiKeys = ref<ApiKeyInfo[]>([])
const apiKeysLoading = ref(false)
const showCreateKeyModal = ref(false)
const newKeyName = ref('')
const newKeyUserId = ref('')
const newKeyRateLimit = ref(60)
const createdKeyValue = ref('')
const apiKeyStats = ref<any>({ keys: [], overall: { activeKeys: 0, totalKeys: 0 } })
type AdminTab = 'accounts' | 'proxies' | 'users' | 'jobs' | 'logs' | 'devices' | 'apikeys'
interface ProxyInfo { id: string; label: string; url: string; isActive: boolean; lastTestedAt: string | null; lastOk: boolean | null; latencyMs: number | null; lastError: string | null; accountCount: number }
type AccountFilter = 'all' | 'active' | 'disabled' | 'cooldown'
type UserFilter = 'all' | 'active' | 'disabled' | 'admin'

const activeTab = ref<AdminTab>('accounts')
const accountKeyword = ref('')
const accountFilter = ref<AccountFilter>('all')
const userKeyword = ref('')
const userFilter = ref<UserFilter>('all')
const lastSyncAt = ref<Date | null>(null)

/* ── Options ── */
const userFilterOptions = computed(() => [
  { label: '全部用户', value: '' },
  ...users.value.map(u => ({ label: u.username, value: u.id })),
])
const roleOptions = [{ label: '普通用户', value: 'user' }, { label: '管理员', value: 'admin' }]
const statusOptions = [{ label: '全部状态', value: '' }, { label: '等待中', value: 'pending' }, { label: '排队中', value: 'queued' }, { label: '处理中', value: 'processing' }, { label: '已完成', value: 'completed' }, { label: '失败', value: 'failed' }, { label: '已删除', value: 'deleted' }]
const logActionOptions = [{ label: '全部行为', value: '' }, { label: '登录', value: 'login' }, { label: '创建任务', value: 'create_job' }, { label: '删除任务', value: 'delete_job' }, { label: '重试任务', value: 'retry_job' }]
const accountFilterOptions = [
  { label: '全部账号', value: 'all' },
  { label: '活跃', value: 'active' },
  { label: '停用', value: 'disabled' },
  { label: '冷却中', value: 'cooldown' },
]
const userStatusFilterOptions = [
  { label: '全部用户', value: 'all' },
  { label: '活跃', value: 'active' },
  { label: '停用', value: 'disabled' },
  { label: '管理员', value: 'admin' },
]

const statusType: Record<string, 'default' | 'info' | 'success' | 'warning' | 'error'> = { pending: 'default', queued: 'default', submitted: 'info', processing: 'info', completed: 'success', failed: 'error', cancelled: 'warning', deleted: 'warning' }
const statusLabel: Record<string, string> = { pending: '等待中', queued: '排队中', submitted: '已提交', processing: '处理中', completed: '已完成', failed: '失败', cancelled: '已取消', deleted: '已删除' }
const actionLabel: Record<string, string> = { login: '登录', create_job: '创建任务', delete_job: '删除任务', retry_job: '重试任务', cancel_job: '取消任务' }
const actionType: Record<string, 'default' | 'info' | 'success' | 'warning' | 'error'> = { login: 'info', create_job: 'success', delete_job: 'error', retry_job: 'warning', cancel_job: 'warning' }

const filteredAccounts = computed(() => {
  const keyword = accountKeyword.value.trim().toLowerCase()
  return accounts.value.filter((acc) => {
    const byFilter = accountFilter.value === 'all'
      || (accountFilter.value === 'active' && acc.isActive)
      || (accountFilter.value === 'disabled' && !acc.isActive)
      || (accountFilter.value === 'cooldown' && acc.inCooldown)
    if (!byFilter)
      return false
    if (!keyword)
      return true
    const haystack = [
      acc.label,
      acc.teamId,
      acc.tokenShort,
      acc.proxyUrl || '',
      acc.lastErrorMessage || '',
    ].join(' ').toLowerCase()
    return haystack.includes(keyword)
  })
})

const filteredUsers = computed(() => {
  const keyword = userKeyword.value.trim().toLowerCase()
  return users.value.filter((user) => {
    const byFilter = userFilter.value === 'all'
      || (userFilter.value === 'active' && user.isActive)
      || (userFilter.value === 'disabled' && !user.isActive)
      || (userFilter.value === 'admin' && user.role === 'admin')
    if (!byFilter)
      return false
    if (!keyword)
      return true
    return `${user.username} ${user.role}`.toLowerCase().includes(keyword)
  })
})

const blockedDeviceCount = computed(() => devices.value.filter(d => d.isBlocked).length)
const activeTaskCount = computed(() => accountStatsData.value.reduce((sum, acc) => sum + (acc.activeTasks?.length || 0), 0))
const concurrencyUsageRate = computed(() => {
  if (overview.value.totalMaxConcurrency <= 0)
    return 0
  return Math.round((overview.value.totalCurrentConcurrency / overview.value.totalMaxConcurrency) * 100)
})
const failureRate = computed(() => {
  if (overview.value.todayJobs <= 0)
    return 0
  return Math.round(((overview.value.todayFailed || 0) / overview.value.todayJobs) * 100)
})
const healthSummary = computed<{ label: string; type: 'success' | 'warning' | 'error'; hint: string }>(() => {
  if (failureRate.value >= 30 || blockedDeviceCount.value >= 3)
    return { label: '高风险', type: 'error', hint: '失败率或安全告警偏高' }
  if (failureRate.value >= 10 || suspiciousSessions.value.length > 0 || concurrencyUsageRate.value >= 85)
    return { label: '需关注', type: 'warning', hint: '建议检查任务质量与账号容量' }
  return { label: '运行良好', type: 'success', hint: '核心指标稳定' }
})
const lastSyncLabel = computed(() => (
  lastSyncAt.value
    ? lastSyncAt.value.toLocaleTimeString('zh-CN', { hour12: false })
    : '未同步'
))

/* ── Dashboard cards ── */
const dashCards = computed(() => [
  { icon: 'ri:group-line', label: '总用户', value: overview.value.totalUsers, sub: `活跃 ${overview.value.activeUsers}`, color: 'from-blue-500 to-cyan-500' },
  { icon: 'ri:movie-2-line', label: '总任务', value: overview.value.totalJobs, sub: `完成 ${overview.value.completedJobs} · 失败 ${overview.value.failedJobs}`, color: 'from-violet-500 to-purple-600' },
  { icon: 'ri:sparkling-2-line', label: '今日生成', value: overview.value.todayJobs, sub: `完成 ${overview.value.todayCompleted} · 失败 ${overview.value.todayFailed}`, color: 'from-amber-500 to-orange-500' },
  { icon: 'ri:pulse-line', label: '近1h完成', value: overview.value.hourlyCompleted, sub: '最近1小时全局', color: 'from-emerald-500 to-cyan-500' },
  { icon: 'ri:loader-4-line', label: '排队 / 处理中', value: overview.value.queuedJobs + overview.value.processingJobs, sub: `排队 ${overview.value.queuedJobs} · 处理 ${overview.value.processingJobs}`, color: 'from-emerald-500 to-teal-600' },
  { icon: 'ri:key-2-line', label: '账号', value: `${overview.value.activeAccounts}/${overview.value.totalAccounts}`, sub: `并发 ${overview.value.totalCurrentConcurrency}/${overview.value.totalMaxConcurrency}`, color: 'from-pink-500 to-rose-600' },
])

const formatTime = (v: string) => new Date(v).toLocaleString('zh-CN', { hour12: false })

/* ── Fetch ── */
const fetchDashboard = async () => {
  try {
    const res = await fetch('/api/runway/admin/dashboard', { headers: headers() })
    if (!res.ok) return
    const data = await res.json()
    overview.value = data.overview
    userStats.value = data.userStats || []
    accountStatsData.value = data.accountStats || []
    lastSyncAt.value = new Date()
    // Sync global speed (only if user isn't mid-drag / pending update)
    if (!speedSyncing.value && !speedDebounceTimer && typeof data.overview?.speedMultiplier === 'number') {
      const serverPct = Math.round(data.overview.speedMultiplier * 100)
      if (serverPct !== speedPct.value) {
        speedSuppressFromServer = true
        speedPct.value = serverPct
        setTimeout(() => { speedSuppressFromServer = false }, 50)
      }
    }
  } catch {}
}

const fetchUsers = async () => {
  userLoading.value = true
  try {
    const res = await fetch('/api/runway/admin/users', { headers: headers() })
    if (!res.ok) throw new Error('加载失败')
    users.value = await res.json()
  } catch (e: any) { message.error(e.message) }
  finally { userLoading.value = false }
}

const fetchAccounts = async () => {
  accountsLoading.value = true
  try {
    const res = await fetch('/api/runway/admin/accounts', { headers: headers() })
    if (!res.ok) throw new Error('加载失败')
    accounts.value = await res.json()
  } catch (e: any) { message.error(e.message) }
  finally { accountsLoading.value = false }
}

const fetchProxies = async () => {
  proxiesLoading.value = true
  try {
    const res = await fetch('/api/runway/admin/proxies', { headers: headers() })
    if (!res.ok) throw new Error('加载代理失败')
    proxies.value = await res.json()
  } catch (e: any) { message.error(e.message) }
  finally { proxiesLoading.value = false }
}

const openCreateProxy = () => {
  editingProxy.value = null
  proxyForm.value = { label: '', url: '', isActive: true }
  showProxyModal.value = true
}

const openEditProxy = (pr: ProxyInfo) => {
  editingProxy.value = pr
  proxyForm.value = { label: pr.label, url: pr.url, isActive: pr.isActive }
  showProxyModal.value = true
}

const saveProxy = async () => {
  const f = proxyForm.value
  if (!f.label.trim() || !f.url.trim()) { message.error('标签和 URL 必填'); return }
  proxySaving.value = true
  try {
    const isEdit = Boolean(editingProxy.value)
    const url = isEdit ? `/api/runway/admin/proxies/${editingProxy.value?.id}` : '/api/runway/admin/proxies'
    const res = await fetch(url, { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify({ label: f.label.trim(), url: f.url.trim(), isActive: f.isActive }) })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '保存失败')
    message.success(isEdit ? '代理已更新' : '代理已添加')
    showProxyModal.value = false
    fetchProxies()
  } catch (e: any) { message.error(e.message) }
  finally { proxySaving.value = false }
}

const deleteProxy = async (id: string) => {
  if (!confirm('确认删除该代理？')) return
  try {
    const res = await fetch(`/api/runway/admin/proxies/${id}`, { method: 'DELETE', headers: headers() })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '删除失败')
    message.success('已删除')
    fetchProxies()
  } catch (e: any) { message.error(e.message) }
}

const testProxy = async (id: string) => {
  proxyTesting.value = id
  try {
    const res = await fetch(`/api/runway/admin/proxies/${id}/test`, { method: 'POST', headers: headers() })
    const data = await res.json()
    if (data.ok) message.success(data.message || '连接成功')
    else message.error(data.message || '连接失败')
    fetchProxies()
  } catch (e: any) { message.error(e.message) }
  finally { proxyTesting.value = null }
}

const proxySelectOptions = computed(() => [
  { label: '不使用代理', value: '' },
  ...proxies.value.filter(p => p.isActive).map(p => ({
    label: `${p.label} — ${p.url}` + (p.lastOk === true ? ' ✓' : p.lastOk === false ? ' ✗' : ''),
    value: p.id,
  })),
])

const onProxySelectChange = (id: string) => {
  accountForm.value.proxyId = id
  if (id) {
    const pr = proxies.value.find(x => x.id === id)
    if (pr) accountForm.value.proxyUrl = pr.url
  }
}


const fetchAdminJobs = async () => {
  jobsLoading.value = true
  try {
    const params = new URLSearchParams({ page: String(jobsPage.value), limit: '20' })
    if (jobsStatus.value) params.set('status', jobsStatus.value)
    if (jobsUser.value) params.set('userId', jobsUser.value)
    const res = await fetch(`/api/runway/admin/jobs?${params}`, { headers: headers() })
    if (!res.ok) throw new Error('加载失败')
    const data = await res.json()
    adminJobs.value = data.jobs || []
    adminJobsTotal.value = data.total || 0
  } catch (e: any) { message.error(e.message) }
  finally { jobsLoading.value = false }
}

// Kill single job
async function killJob(jobId: string) {
  if (!confirm(`确认终止任务 ${jobId.slice(0, 8)}...？`)) return
  try {
    const res = await fetch(`/api/runway/admin/jobs/${jobId}/kill`, { method: 'POST', headers: headers() })
    const data = await res.json()
    if (data.ok) {
      message.success(`任务已终止 (原状态: ${data.previousStatus})`)
      fetchAdminJobs()
      fetchDashboard()
    } else {
      message.error(data.error || '终止失败')
    }
  } catch (e: any) { message.error(e.message) }
}

// Kill all stuck jobs
const killingStuck = ref(false)
async function killStuckJobs() {
  if (!confirm('确认批量清理所有卡住超过30分钟的任务？')) return
  try {
    killingStuck.value = true
    const res = await fetch('/api/runway/admin/jobs/kill-stuck', {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 30 }),
    })
    const data = await res.json()
    if (data.ok) {
      if (data.killed === 0) {
        message.info(data.message || '没有卡住的任务')
      } else {
        message.success(`已清理 ${data.killed} 个卡住任务，释放 ${data.accounts} 个账号槽位`)
      }
      fetchAdminJobs()
      fetchDashboard()
    } else {
      message.error(data.error || '清理失败')
    }
  } catch (e: any) { message.error(e.message) }
  finally { killingStuck.value = false }
}

const fetchLogs = async () => {
  logsLoading.value = true
  try {
    const params = new URLSearchParams({ page: String(logsPage.value), limit: '20' })
    if (logsAction.value) params.set('action', logsAction.value)
    const res = await fetch(`/api/runway/admin/logs?${params}`, { headers: headers() })
    if (!res.ok) throw new Error('加载失败')
    const data = await res.json()
    logs.value = data.logs || []
    logsTotal.value = data.total || 0
  } catch (e: any) { message.error(e.message) }
  finally { logsLoading.value = false }
}

const fetchDevices = async () => {
  devicesLoading.value = true
  try {
    const res = await fetch('/api/runway/admin/devices', { headers: headers() })
    devices.value = await res.json()
  } catch {} finally { devicesLoading.value = false }
}

const fetchSuspiciousSessions = async () => {
  sessionsLoading.value = true
  try {
    const res = await fetch('/api/runway/admin/sessions/suspicious', { headers: headers() })
    suspiciousSessions.value = await res.json()
  } catch {} finally { sessionsLoading.value = false }
}

const updateDeviceStatus = async (id: string, action: 'trust' | 'block' | 'unblock') => {
  try {
    const res = await fetch(`/api/runway/admin/devices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify({ action }) })
    if (!res.ok) throw new Error('操作失败')
    message.success(action === 'trust' ? '已信任' : action === 'block' ? '已封禁' : '已解封')
    fetchDevices()
  } catch (e: any) { message.error(e.message) }
}

const removeDevice = async (id: string) => {
  if (!window.confirm('确认移除该设备？用户下次登录需重新验证。')) return
  try {
    const res = await fetch(`/api/runway/admin/devices/${id}`, { method: 'DELETE', headers: headers() })
    if (!res.ok) throw new Error('删除失败')
    message.success('已移除')
    fetchDevices()
  } catch (e: any) { message.error(e.message) }
}

const refreshAll = async () => {
  await Promise.all([
    fetchDashboard(),
    fetchUsers(),
    fetchAccounts(),
    fetchAdminJobs(),
    fetchLogs(),
    fetchDevices(),
    fetchSuspiciousSessions(),
  ])
}

/* ── API Key functions ── */
async function fetchApiKeys() {
  apiKeysLoading.value = true
  try {
    const res = await fetch('/api/runway/admin/api-keys', { headers: { Authorization: `Bearer ${jwt.value}` } })
    apiKeys.value = await res.json()
  } catch (e) { ms.error('获取API Key列表失败') }
  finally { apiKeysLoading.value = false }
}

async function fetchApiKeyStats() {
  try {
    const res = await fetch('/api/runway/admin/api-keys/stats', { headers: { Authorization: `Bearer ${jwt.value}` } })
    apiKeyStats.value = await res.json()
  } catch (e) { console.error('fetchApiKeyStats error', e) }
}

async function createApiKey() {
  if (!newKeyName.value || !newKeyUserId.value) { ms.warning('请填写名称和用户ID'); return }
  try {
    const res = await fetch('/api/runway/admin/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.value}` },
      body: JSON.stringify({ name: newKeyName.value, userId: newKeyUserId.value, rateLimit: newKeyRateLimit.value }),
    })
    const data = await res.json()
    if (data.key) {
      createdKeyValue.value = data.key
      newKeyName.value = ''
      newKeyUserId.value = ''
      newKeyRateLimit.value = 60
      fetchApiKeys()
    } else { ms.error(data.error || '创建失败') }
  } catch (e) { ms.error('创建API Key失败') }
}

async function toggleApiKey(id: string, enabled: boolean) {
  try {
    await fetch(`/api/runway/admin/api-keys/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.value}` },
      body: JSON.stringify({ enabled }),
    })
    fetchApiKeys()
  } catch (e) { ms.error('更新失败') }
}

async function deleteApiKey(id: string) {
  if (!confirm('确定删除此API Key？')) return
  try {
    await fetch(`/api/runway/admin/api-keys/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwt.value}` },
    })
    fetchApiKeys()
  } catch (e) { ms.error('删除失败') }
}

const apiKeyColumns = [
  { title: '名称', key: 'name', width: 100 },
  { title: '前缀', key: 'prefix', width: 100 },
  { title: '用户', key: 'username', width: 100 },
  { title: '频率限制', key: 'rateLimit', width: 80 },
  {
    title: '状态', key: 'enabled', width: 70,
    render: (row: any) => h(NSwitch, {
      value: row.enabled,
      'onUpdate:value': (v: boolean) => toggleApiKey(row.id, v),
    }),
  },
  { title: '最后使用', key: 'lastUsedAt', width: 140, render: (row: any) => row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString('zh-CN') : '-' },
  { title: '创建时间', key: 'createdAt', width: 140, render: (row: any) => new Date(row.createdAt).toLocaleString('zh-CN') },
  {
    title: '操作', key: 'actions', width: 80,
    render: (row: any) => h(NButton, { size: 'tiny', type: 'error', onClick: () => deleteApiKey(row.id) }, { default: () => '删除' }),
  },
]

const refreshCurrentTab = () => {
  if (activeTab.value === 'proxies') { fetchProxies(); return }
  if (activeTab.value === 'accounts') {
    fetchAccounts()
    fetchDashboard()
  } else if (activeTab.value === 'users') {
    fetchUsers()
    fetchDashboard()
  } else if (activeTab.value === 'jobs') {
    fetchAdminJobs()
  } else if (activeTab.value === 'logs') {
    fetchLogs()
  } else if (activeTab.value === 'apikeys') { fetchApiKeys(); fetchApiKeyStats(); return }
  if (activeTab.value === 'devices') {
    fetchDevices()
    fetchSuspiciousSessions()
  }
}

const onJobsFilterChange = () => {
  if (jobsPage.value !== 1) {
    jobsPage.value = 1
    return
  }
  fetchAdminJobs()
}

const onLogsFilterChange = () => {
  if (logsPage.value !== 1) {
    logsPage.value = 1
    return
  }
  fetchLogs()
}

/* ── Account CRUD ── */
const openCreateAccount = () => {
  editingAccount.value = null
  accountForm.value = { label: '', token: '', teamId: '', proxyId: '', proxyUrl: '', maxConcurrency: 2, priority: 0 }
  loginForm.value = { email: '', password: '', proxyUrl: '' }
  accountModalTab.value = 'login'
  showAccountModal.value = true
}

const openEditAccount = (acc: AccountInfo) => {
  editingAccount.value = acc
  accountForm.value = { label: acc.label, token: '', teamId: acc.teamId, proxyId: acc.proxyId || '', proxyUrl: acc.proxyUrl || '', maxConcurrency: acc.maxConcurrency, priority: acc.priority }
  accountModalTab.value = 'manual'
  showAccountModal.value = true
}

const saveAccount = async () => {
  const f = accountForm.value
  if (!f.label.trim()) { message.error('请输入账号标签'); return }
  if (!editingAccount.value && (!f.token.trim() || !f.teamId.trim())) { message.error('新建账号时 Token 和 TeamID 必填'); return }

  accountSaving.value = true
  try {
    const payload: Record<string, unknown> = { label: f.label.trim(), maxConcurrency: f.maxConcurrency, priority: f.priority, proxyUrl: f.proxyUrl.trim() || null, proxyId: f.proxyId || null }
    if (f.token.trim()) payload.token = f.token.trim()
    if (f.teamId.trim()) payload.teamId = f.teamId.trim()

    const isEdit = Boolean(editingAccount.value)
    const url = isEdit ? `/api/runway/admin/accounts/${editingAccount.value?.id}` : '/api/runway/admin/accounts'
    const res = await fetch(url, { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify(payload) })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '保存失败')

    message.success(isEdit ? '账号已更新' : '账号已添加')
    showAccountModal.value = false
    fetchAccounts(); fetchDashboard()
  } catch (e: any) { message.error(e.message) }
  finally { accountSaving.value = false }
}

const loginRunway = async () => {
  const f = loginForm.value
  if (!f.email.trim() || !f.password.trim()) { message.error('请输入邮箱和密码'); return }
  loginLoading.value = true
  try {
    const res = await fetch('/api/runway/admin/accounts/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers() },
      body: JSON.stringify({ email: f.email.trim(), password: f.password.trim(), proxyUrl: f.proxyUrl.trim() || undefined }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '登录失败')

    // Fill the account form with login result
    accountForm.value.token = data.token
    accountForm.value.teamId = data.teamId
    accountForm.value.proxyUrl = f.proxyUrl.trim()
    if (!accountForm.value.label.trim()) accountForm.value.label = data.username || data.email || f.email.split('@')[0]

    message.success(`登录成功! 用户: ${data.username || data.email}, TeamID: ${data.teamId}`)
    // Auto-save the account
    await saveAccount()
  } catch (e: any) { message.error(e.message) }
  finally { loginLoading.value = false }
}

const toggleAccountActive = async (acc: AccountInfo) => {
  try {
    const res = await fetch(`/api/runway/admin/accounts/${acc.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify({ isActive: !acc.isActive }) })
    if (!res.ok) throw new Error('操作失败')
    message.success(!acc.isActive ? '已启用' : '已停用')
    fetchAccounts(); fetchDashboard()
  } catch (e: any) { message.error(e.message) }
}

const deleteAccount = async (id: string) => {
  if (!window.confirm('确认停用该账号？')) return
  try {
    const res = await fetch(`/api/runway/admin/accounts/${id}`, { method: 'DELETE', headers: headers() })
    if (!res.ok) throw new Error('操作失败')
    message.success('已停用')
    fetchAccounts(); fetchDashboard()
  } catch (e: any) { message.error(e.message) }
}

const resetCooldown = async (id: string) => {
  try {
    const res = await fetch(`/api/runway/admin/accounts/${id}/reset-cooldown`, { method: 'POST', headers: headers() })
    if (!res.ok) throw new Error('操作失败')
    message.success('冷却已重置')
    fetchAccounts()
  } catch (e: any) { message.error(e.message) }
}

const resetBatch = async (id: string) => {
  try {
    const res = await fetch(`/api/runway/admin/accounts/${id}/reset-batch`, { method: 'POST', headers: headers() })
    if (!res.ok) throw new Error('操作失败')
    message.success('批次休息已重置')
    fetchAccounts()
  } catch (e: any) { message.error(e.message) }
}

const testAccount = async (id: string) => {
  accountTesting.value = id
  try {
    const res = await fetch(`/api/runway/admin/accounts/${id}/test`, { headers: headers() })
    const data = await res.json()
    if (data.ok) {
      message.success(data.message)
    } else {
      message.error(data.message)
    }
  } catch (e: any) { message.error(e.message) }
  finally { accountTesting.value = null }
}

/* ── User CRUD ── */
const openCreateUser = () => {
  editingUser.value = null
  userForm.value = { username: '', password: '', role: 'user', isActive: true, maxConcurrency: null, dailyQuota: null, totalQuota: null }
  showUserModal.value = true
}

const openEditUser = (user: AdminUser) => {
  editingUser.value = user
  userForm.value = { username: user.username, password: '', role: user.role, isActive: user.isActive, maxConcurrency: user.maxConcurrency, dailyQuota: user.dailyQuota, totalQuota: user.totalQuota }
  showUserModal.value = true
}

const saveUser = async () => {
  const f = userForm.value
  if (!f.username.trim()) { message.error('请输入用户名'); return }
  if (!editingUser.value && !f.password.trim()) { message.error('新建用户时必须设置密码'); return }

  userSaving.value = true
  try {
    const payload: Record<string, unknown> = { username: f.username.trim(), role: f.role, isActive: f.isActive, maxConcurrency: f.maxConcurrency ?? null, dailyQuota: f.dailyQuota ?? null, totalQuota: f.totalQuota ?? null }
    if (f.password.trim()) payload.password = f.password.trim()

    const isEdit = Boolean(editingUser.value)
    const url = isEdit ? `/api/runway/admin/users/${editingUser.value?.id}` : '/api/runway/admin/users'
    const res = await fetch(url, { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify(payload) })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '保存失败')

    message.success(isEdit ? '用户已更新' : '用户已创建')
    showUserModal.value = false
    fetchUsers(); fetchDashboard()
  } catch (e: any) { message.error(e.message) }
  finally { userSaving.value = false }
}

const toggleActive = async (user: AdminUser) => {
  try {
    const res = await fetch(`/api/runway/admin/users/${user.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify({ isActive: !user.isActive }) })
    if (!res.ok) throw new Error('操作失败')
    message.success(!user.isActive ? '已启用' : '已停用')
    fetchUsers(); fetchDashboard()
  } catch (e: any) { message.error(e.message) }
}

const deleteUser = async (id: string) => {
  if (!window.confirm('确认删除该用户？不可恢复。')) return
  try {
    const res = await fetch(`/api/runway/admin/users/${id}`, { method: 'DELETE', headers: headers() })
    if (!res.ok) throw new Error('删除失败')
    message.success('已删除')
    fetchUsers(); fetchDashboard()
  } catch (e: any) { message.error(e.message) }
}

/* ── Table columns ── */
const userColumns = [
  { title: '用户名', key: 'username', width: 120 },
  { title: '角色', key: 'role', width: 90, render: (row: AdminUser) => h(NTag, { type: row.role === 'admin' ? 'error' : 'info', size: 'small', round: true, bordered: false }, () => row.role === 'admin' ? '管理员' : '用户') },
  { title: '状态', key: 'isActive', width: 80, render: (row: AdminUser) => h(NTag, { type: row.isActive ? 'success' : 'warning', size: 'small', round: true, bordered: false }, () => row.isActive ? '启用' : '停用') },
  { title: '并发', key: 'maxConcurrency', width: 70, render: (row: AdminUser) => String(row.maxConcurrency ?? '默认') },
  { title: '日配额', key: 'dailyQuota', width: 80, render: (row: AdminUser) => String(row.dailyQuota ?? '不限') },
  { title: '总配额', key: 'totalQuota', width: 80, render: (row: AdminUser) => String(row.totalQuota ?? '不限') },
  { title: '创建时间', key: 'createdAt', width: 170, render: (row: AdminUser) => formatTime(row.createdAt) },
  { title: '操作', key: 'actions', width: 220, render: (row: AdminUser) => h('div', { class: 'flex gap-1' }, [
    h(NButton, { size: 'tiny', tertiary: true, onClick: () => openEditUser(row) }, () => '编辑'),
    h(NButton, { size: 'tiny', tertiary: true, type: row.isActive ? 'warning' : 'success', onClick: () => toggleActive(row) }, () => row.isActive ? '停用' : '启用'),
    h(NButton, { size: 'tiny', tertiary: true, type: 'error', onClick: () => deleteUser(row.id) }, () => '删除'),
  ]) },
]

const jobColumns = [
  { title: '用户', key: 'user', width: 100, render: (row: AdminJob) => h(NTag, { size: 'small', round: true, bordered: false, type: 'info' }, () => row.user?.username ?? '—') },
  { title: '账号', key: 'account', width: 100, render: (row: AdminJob) => row.account ? h(NTag, { size: 'small', round: true, bordered: false, type: 'default' }, () => row.account!.label) : '—' },
  { title: '状态', key: 'status', width: 100, render: (row: AdminJob) => h(NTag, { type: statusType[row.status] ?? 'default', size: 'small', round: true, bordered: false }, () => statusLabel[row.status] || row.status) },
  { title: '时长', key: 'duration', width: 70, render: (row: AdminJob) => row.duration ? `${row.duration}s` : '—' },
  { title: '提示词', key: 'prompt', ellipsis: { tooltip: true } },
  { title: '时间', key: 'createdAt', width: 170, render: (row: AdminJob) => formatTime(row.createdAt) },
]

const logColumns = [
  { title: '用户', key: 'user', width: 100, render: (row: AdminLog) => h(NTag, { size: 'small', round: true, bordered: false, type: 'info' }, () => row.user?.username ?? '—') },
  { title: '行为', key: 'action', width: 110, render: (row: AdminLog) => h(NTag, { type: actionType[row.action] ?? 'default', size: 'small', round: true, bordered: false }, () => actionLabel[row.action] || row.action) },
  { title: '详情', key: 'detail', ellipsis: { tooltip: true } },
  { title: 'IP', key: 'ip', width: 140 },
  { title: '时间', key: 'createdAt', width: 170, render: (row: AdminLog) => formatTime(row.createdAt) },
]

const deviceColumns = [
  { title: '用户', key: 'user', width: 100, render: (row: DeviceInfo) => h(NTag, { size: 'small', round: true, bordered: false, type: 'info' }, () => row.user?.username ?? '—') },
  { title: '设备', key: 'deviceName', width: 140 },
  { title: '浏览器', key: 'browser', width: 90 },
  { title: '系统', key: 'os', width: 80 },
  { title: 'IP', key: 'lastIp', width: 130 },
  { title: '指纹', key: 'fingerprint', width: 90, render: (row: DeviceInfo) => row.fingerprint.slice(0, 8) },
  { title: '状态', key: 'status', width: 80, render: (row: DeviceInfo) => h(NTag, { type: row.isBlocked ? 'error' : row.isTrusted ? 'success' : 'warning', size: 'small', round: true, bordered: false }, () => row.isBlocked ? '封禁' : row.isTrusted ? '信任' : '新设备') },
  { title: '最后活跃', key: 'lastSeenAt', width: 160, render: (row: DeviceInfo) => formatTime(row.lastSeenAt) },
  { title: '操作', key: 'actions', width: 200, render: (row: DeviceInfo) => h('div', { class: 'flex gap-1' }, [
    !row.isTrusted && !row.isBlocked ? h(NButton, { size: 'tiny', tertiary: true, type: 'success', onClick: () => updateDeviceStatus(row.id, 'trust') }, () => '信任') : null,
    !row.isBlocked ? h(NButton, { size: 'tiny', tertiary: true, type: 'error', onClick: () => updateDeviceStatus(row.id, 'block') }, () => '封禁') : h(NButton, { size: 'tiny', tertiary: true, type: 'success', onClick: () => updateDeviceStatus(row.id, 'unblock') }, () => '解封'),
    h(NButton, { size: 'tiny', tertiary: true, type: 'warning', onClick: () => removeDevice(row.id) }, () => '移除'),
  ]) },
]

const sessionColumns = [
  { title: '用户', key: 'user', width: 100, render: (row: LoginSessionInfo) => h(NTag, { size: 'small', round: true, bordered: false, type: 'info' }, () => row.user?.username ?? '—') },
  { title: 'IP', key: 'ip', width: 130 },
  { title: '地区', key: 'location', width: 140, render: (row: LoginSessionInfo) => [row.city, row.region, row.country].filter(Boolean).join(', ') || '—' },
  { title: '可疑原因', key: 'suspiciousReason', ellipsis: { tooltip: true } },
  { title: '时间', key: 'createdAt', width: 170, render: (row: LoginSessionInfo) => formatTime(row.createdAt) },
]

/* ── Watchers ── */
watch(() => props.show, (v) => { if (v) refreshAll() })
watch(jobsPage, () => fetchAdminJobs())
watch(logsPage, () => fetchLogs())
watch(activeTab, () => { if (props.show) refreshCurrentTab() })

/* Auto-refresh dashboard every 30s when panel is open */
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null
watch(() => props.show, (v) => {
  if (v) {
    autoRefreshTimer = setInterval(fetchDashboard, 30000)
  } else {
    if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null }
  }
})
onUnmounted(() => { if (autoRefreshTimer) clearInterval(autoRefreshTimer) })
</script>

<template>
  <NDrawer :show="props.show" placement="right" :width="typeof window !== 'undefined' && window.innerWidth < 768 ? '100%' : '92%'" @update:show="emit('update:show', $event)">
    <NDrawerContent closable class="admin-drawer-content">
      <template #header>
        <div class="flex items-center gap-3">
          <div class="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/25">
            <SvgIcon icon="ri:dashboard-3-line" class="text-xl text-white" />
            <div class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#1a1a2e] bg-emerald-400" />
          </div>
          <div>
            <p class="text-base font-bold tracking-wide text-white/95">管理控制台</p>
            <p class="text-[11px] text-white/40">用户管理 · 账号管理 · 任务监控 · 审计日志</p>
          </div>
        </div>
      </template>

      <div class="runway-admin-panel space-y-5">
        <!-- Hero status bar -->
        <div class="panel-hero rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 backdrop-blur-xl">
          <div class="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500/[0.05] via-transparent to-indigo-500/[0.05] pointer-events-none" />
          <div class="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div class="flex items-center gap-2">
                <SvgIcon icon="ri:pulse-line" class="text-lg text-violet-400" />
                <p class="text-sm font-bold text-white/90">运行态势</p>
              </div>
              <p class="mt-1.5 text-xs text-white/35">
                最近同步 {{ lastSyncLabel }} · 活跃任务 {{ activeTaskCount }} · 可疑登录 {{ suspiciousSessions.length }}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <NTag :type="healthSummary.type" size="small" round :bordered="false">
                {{ healthSummary.label }} · {{ healthSummary.hint }}
              </NTag>
              <NButton size="small" secondary class="glass-btn" @click="refreshCurrentTab">
                <SvgIcon icon="ri:refresh-line" class="mr-1" /> 刷新当前
              </NButton>
              <NButton size="small" class="glass-btn" @click="refreshAll">
                <SvgIcon icon="ri:loop-right-line" class="mr-1" /> 全量刷新
              </NButton>
              <NButton type="primary" size="small" class="accent-btn" @click="openCreateAccount">
                <SvgIcon icon="ri:key-2-line" class="mr-1" /> 添加账号
              </NButton>
              <NButton type="primary" ghost size="small" @click="openCreateUser">
                <SvgIcon icon="ri:user-add-line" class="mr-1" /> 新建用户
              </NButton>
            </div>
          </div>

          <!-- Metric chips row -->
          <div class="relative mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div class="metric-chip">
              <div class="flex items-center gap-2">
                <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-indigo-500/20">
                  <SvgIcon icon="ri:speed-line" class="text-sm text-violet-400" />
                </div>
                <p class="metric-label">并发利用率</p>
              </div>
              <p class="metric-value">{{ concurrencyUsageRate }}%</p>
              <NProgress
                class="mt-1.5"
                type="line"
                :percentage="Math.min(concurrencyUsageRate, 100)"
                :status="concurrencyUsageRate >= 90 ? 'warning' : 'success'"
                :show-indicator="false"
                :height="4"
              />
            </div>
            <div class="metric-chip">
              <div class="flex items-center gap-2">
                <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-red-500/20 to-orange-500/20">
                  <SvgIcon icon="ri:error-warning-line" class="text-sm text-red-400" />
                </div>
                <p class="metric-label">今日失败率</p>
              </div>
              <p class="metric-value">{{ failureRate }}%</p>
              <p class="metric-hint">失败 {{ overview.failedJobs }} / 今日 {{ overview.todayJobs }}</p>
            </div>
            <div class="metric-chip">
              <div class="flex items-center gap-2">
                <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/20 to-yellow-500/20">
                  <SvgIcon icon="ri:shield-check-line" class="text-sm text-amber-400" />
                </div>
                <p class="metric-label">设备风控</p>
              </div>
              <p class="metric-value">{{ blockedDeviceCount }}</p>
              <p class="metric-hint">封禁设备 · 可疑会话 {{ suspiciousSessions.length }}</p>
            </div>
            <div class="metric-chip">
              <div class="flex items-center gap-2">
                <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20">
                  <SvgIcon icon="ri:stack-line" class="text-sm text-cyan-400" />
                </div>
                <p class="metric-label">任务压力</p>
              </div>
              <p class="metric-value">{{ overview.queuedJobs + overview.processingJobs }}</p>
              <p class="metric-hint">排队 {{ overview.queuedJobs }} · 处理中 {{ overview.processingJobs }}</p>
            </div>
          </div>
        </div>

        <!-- 全局速度 card -->
        <div class="speed-card relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 backdrop-blur-xl" :class="speedColorClass">
          <div class="absolute inset-0 pointer-events-none speed-card-bg" />
          <div class="relative flex flex-col gap-4 lg:flex-row lg:items-center">
            <div class="flex-shrink-0 text-center lg:w-48">
              <div class="flex items-center justify-center gap-2">
                <SvgIcon icon="ri:speed-up-line" class="text-lg" />
                <p class="text-sm font-bold text-white/90">全局速度</p>
                <NTooltip>
                  <template #trigger>
                    <SvgIcon icon="ri:question-line" class="text-xs text-white/40 cursor-help" />
                  </template>
                  <div style="max-width: 280px">数值越高人类行为延迟越短，提交速度越快。100%=正常节奏，200%=最激进，10%=极慢。冷却与批次休息不受影响。</div>
                </NTooltip>
              </div>
              <p class="speed-big-number mt-2">{{ speedPct }}%</p>
              <p class="text-[11px] text-white/40">全局速度倍率 · {{ speedZoneLabel }}</p>
              <div v-if="!isDefaultSpeed" class="mt-2 inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 speed-pulse">
                <span class="h-1.5 w-1.5 rounded-full bg-amber-400" /> 非默认速度
              </div>
            </div>
            <div class="flex-1">
              <NSlider
                :value="speedPct"
                :min="10"
                :max="200"
                :step="5"
                :tooltip="true"
                :format-tooltip="(v: number) => `${v}%`"
                @update:value="onSpeedChange"
              />
              <div class="mt-3 flex flex-wrap items-center gap-2">
                <span class="text-[11px] text-white/35 mr-1">快速预设:</span>
                <NButton v-for="p in [25, 50, 100, 150, 200]" :key="p" size="tiny" :type="speedPct === p ? 'primary' : 'default'" :ghost="speedPct !== p" @click="setSpeedPreset(p)">{{ p }}%</NButton>
              </div>
              <div class="mt-4 flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <div class="flex items-center gap-2">
                  <SvgIcon icon="ri:moon-line" class="text-sm text-indigo-300" />
                  <span class="text-xs font-medium text-white/80">深夜模式</span>
                  <NTooltip trigger="hover" placement="top">
                    <template #trigger>
                      <SvgIcon icon="ri:information-line" class="text-xs text-white/30" />
                    </template>
                    <div style="max-width: 260px">开启后，凌晨 02-08 时段账号有 80% 概率跳过提交并休眠数分钟，模拟真实作息。关闭则全天候跑。</div>
                  </NTooltip>
                  <span class="text-[10px]" :class="deepNightEnabled ? text-emerald-300 : text-amber-300">{{ deepNightEnabled ? "启用中" : "已关闭" }}</span>
                </div>
                <NSwitch :value="deepNightEnabled" :loading="deepNightSyncing" @update:value="onDeepNightChange" />
              </div>
            </div>
          </div>
        </div>

        <!-- Dashboard overview cards -->
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <div
            v-for="card in dashCards"
            :key="card.label"
            class="dash-card group relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-md"
          >
            <div class="absolute -right-3 -top-3 h-20 w-20 rounded-full bg-gradient-to-br opacity-[0.07] transition-opacity duration-300 group-hover:opacity-[0.15]" :class="card.color" />
            <div class="relative flex items-start justify-between">
              <div>
                <p class="text-[11px] font-medium uppercase tracking-wider text-white/35">{{ card.label }}</p>
                <p class="mt-1.5 text-2xl font-bold text-white/90">{{ card.value }}</p>
                <p class="mt-1 text-[11px] text-white/30">{{ card.sub }}</p>
              </div>
              <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg" :class="card.color" style="box-shadow: 0 4px 14px rgba(0,0,0,0.2)">
                <SvgIcon :icon="card.icon" class="text-lg" />
              </div>
            </div>
            <div class="absolute bottom-0 left-0 h-[2px] w-full bg-gradient-to-r opacity-0 transition-opacity duration-300 group-hover:opacity-100" :class="card.color" />
          </div>
        </div>

        <!-- User stats cards -->
        <div v-if="userStats.length > 0" class="glass-section rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 backdrop-blur-md">
          <div class="mb-4 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20">
                <SvgIcon icon="ri:group-line" class="text-sm text-blue-400" />
              </div>
              <p class="text-sm font-bold text-white/90">用户用量概览</p>
            </div>
            <NButton size="tiny" quaternary class="glass-btn-sm" @click="fetchDashboard">
              <SvgIcon icon="ri:refresh-line" class="mr-1" /> 刷新
            </NButton>
          </div>
          <div class="admin-scrollbar max-h-[360px] space-y-2 overflow-y-auto pr-1">
            <div
              v-for="u in userStats"
              :key="u.id"
              class="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 transition-colors duration-200 hover:border-white/[0.12] hover:bg-white/[0.06]"
            >
              <div
                class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-md"
                :class="u.role === 'admin' ? 'bg-gradient-to-br from-red-500 to-pink-500' : 'bg-gradient-to-br from-cyan-500 to-blue-500'"
              >
                {{ u.username.charAt(0).toUpperCase() }}
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="text-sm font-semibold text-white/90">{{ u.username }}</span>
                  <NTag :type="u.role === 'admin' ? 'error' : 'info'" size="tiny" round :bordered="false">{{ u.role === 'admin' ? '管理' : '用户' }}</NTag>
                  <NTag v-if="!u.isActive" type="warning" size="tiny" round :bordered="false">已停用</NTag>
                </div>
                <div class="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-white/35">
                  <span>总任务 <b class="text-white/70">{{ u.totalJobs }}</b><template v-if="u.totalQuota !== null">/{{ u.totalQuota }}</template></span>
                  <span>今日 <b class="text-white/70">{{ u.todayJobs }}</b><template v-if="u.dailyQuota !== null">/{{ u.dailyQuota }}</template></span>
                  <span>今日完成 <b class="text-emerald-400">{{ u.todayCompleted }}</b></span>
                  <span>近1h <b :class="u.hourlyCompleted > 0 ? 'text-emerald-400' : 'text-white/30'">{{ u.hourlyCompleted }}</b></span>
                  <span v-if="u.todayFailed > 0">失败 <b class="text-red-400">{{ u.todayFailed }}</b></span>
                  <span>并发 <b :class="u.currentActive > 0 ? 'text-orange-400' : 'text-emerald-400'">{{ u.currentActive }}</b>/<b class="text-white/70">{{ u.maxConcurrency ?? '不限' }}</b></span>
                </div>
              </div>
              <div v-if="u.totalQuota !== null" class="w-20 flex-shrink-0">
                <NProgress
                  type="line"
                  :percentage="Math.min(100, Math.round(u.totalJobs / u.totalQuota * 100))"
                  :status="u.totalJobs >= u.totalQuota ? 'error' : 'success'"
                  :show-indicator="false"
                  :height="4"
                />
                <p class="mt-0.5 text-center text-[10px] text-white/30">{{ Math.round(u.totalJobs / u.totalQuota * 100) }}%</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Account stats (in dashboard area) -->
        <div v-if="accountStatsData.length > 0" class="glass-section rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 backdrop-blur-md">
          <div class="mb-4 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20">
                <SvgIcon icon="ri:key-2-line" class="text-sm text-emerald-400" />
              </div>
              <p class="text-sm font-bold text-white/90">账号并发概览</p>
            </div>
            <NButton size="tiny" quaternary class="glass-btn-sm" @click="fetchDashboard">
              <SvgIcon icon="ri:refresh-line" class="mr-1" /> 刷新
            </NButton>
          </div>
          <div class="admin-scrollbar max-h-[360px] space-y-3 overflow-y-auto pr-1">
            <div
              v-for="a in accountStatsData"
              :key="a.id"
              class="overflow-hidden rounded-xl border transition-colors duration-200"
              :class="a.isActive ? 'border-white/[0.08] hover:border-white/[0.15]' : 'border-red-500/20 bg-red-500/[0.03]'"
            >
              <div class="flex items-center justify-between border-b px-4 py-3" :class="a.isActive ? 'border-white/[0.06] bg-white/[0.03]' : 'border-red-500/10'">
                <div class="flex items-center gap-2.5">
                  <div class="relative flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-white" :class="a.isActive ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-gradient-to-br from-red-400 to-red-500'">
                    {{ a.label.charAt(0).toUpperCase() }}
                    <!-- Status dot -->
                    <div class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#1a1a2e]" :class="a.isActive ? 'bg-emerald-400' : 'bg-red-400'" />
                  </div>
                  <span class="text-sm font-semibold text-white/90">{{ a.label }}</span>
                  <NTag :type="a.isActive ? 'success' : 'warning'" size="tiny" round :bordered="false">{{ a.isActive ? '活跃' : '停用' }}</NTag>
                </div>
                <div class="flex items-center gap-2 text-[11px] text-white/35">
                  <NTooltip trigger="hover" placement="top">
                    <template #trigger>
                      <span class="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 transition-colors"
                        :class="a.hourlyGenerated > 0 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/[0.03] text-white/30'">
                        <span class="relative flex h-1.5 w-1.5">
                          <span v-if="a.hourlyGenerated > 0" class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                          <span class="relative inline-flex h-1.5 w-1.5 rounded-full" :class="a.hourlyGenerated > 0 ? 'bg-emerald-400' : 'bg-white/30'" />
                        </span>
                        近1h <b class="ml-0.5">{{ a.hourlyGenerated }}</b>
                      </span>
                    </template>
                    最近1小时完成的视频数
                  </NTooltip>
                  <span>已生成 <b class="text-white/60">{{ a.totalGenerated }}</b></span>
                </div>
              </div>
              <div class="px-4 py-2.5">
                <div class="flex items-center justify-between text-[11px] text-white/40">
                  <span>并发占用</span>
                  <span><b :class="a.currentConcurrency >= a.maxConcurrency ? 'text-orange-400' : 'text-emerald-400'">{{ a.currentConcurrency }}</b> / {{ a.maxConcurrency }}</span>
                </div>
                <NProgress
                  type="line"
                  :percentage="a.maxConcurrency > 0 ? Math.round(a.currentConcurrency / a.maxConcurrency * 100) : 0"
                  :status="a.currentConcurrency >= a.maxConcurrency ? 'warning' : 'success'"
                  :show-indicator="false"
                  :height="4"
                  class="mt-1.5"
                />
              </div>
              <div v-if="a.activeTasks && a.activeTasks.filter(x => ['processing','submitted'].includes(x.status)).length > 0" class="border-t border-white/[0.06] px-4 py-2.5">
                <p class="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/25">正在处理的视频 ({{ a.activeTasks.filter(x => ['processing','submitted'].includes(x.status)).length }})</p>
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  <div v-for="t in a.activeTasks.filter(x => ['processing','submitted'].includes(x.status))" :key="t.jobId"
                    class="group relative overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.02] transition-all hover:border-white/[0.15]">
                    <div class="relative aspect-video bg-black/30">
                      <img v-if="getTaskThumb(t)" :src="getTaskThumb(t)!" class="h-full w-full object-cover opacity-70" />
                      <div v-else class="flex h-full w-full items-center justify-center">
                        <SvgIcon icon="ri:film-line" class="text-2xl text-white/10" />
                      </div>
                      <div v-if="t.progress > 0" class="absolute bottom-0 left-0 right-0">
                        <div class="h-1 bg-emerald-500/80 transition-all" :style="{ width: Math.round(t.progress * 100) + '%' }" />
                      </div>
                      <div class="absolute left-1 top-1">
                        <span class="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold backdrop-blur-sm"
                          :class="t.status === 'processing' ? 'bg-blue-500/40 text-blue-200' : 'bg-amber-500/40 text-amber-200'">
                          <span class="h-1 w-1 rounded-full animate-pulse" :class="t.status === 'processing' ? 'bg-blue-300' : 'bg-amber-300'" />
                          {{ t.status === 'processing' ? '生成中' : '提交中' }}
                        </span>
                      </div>
                      <div v-if="t.progress > 0" class="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300 backdrop-blur-sm">
                        {{ Math.round(t.progress * 100) }}%
                      </div>
                    </div>
                    <div class="px-2 py-1.5">
                      <div class="flex items-center gap-1">
                        <span class="text-[10px] font-medium text-violet-400">{{ t.username }}</span>
                        <span class="text-[9px] text-white/20">#{{ t.jobId }}</span>
                      </div>
                      <p class="truncate text-[9px] text-white/25">{{ t.prompt || '...' }}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="border-t border-white/[0.06] px-4 py-2.5">
                <p class="text-center text-[11px] text-white/15">暂无处理中的任务</p>
              </div>            </div>
          </div>
        </div>

        <!-- Tabs: Accounts / Users / Jobs / Logs / Devices -->
        <div class="glass-section rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 backdrop-blur-md">
          <NTabs v-model:value="activeTab" type="line" animated class="admin-tabs">
            <!-- Accounts Tab -->
            <NTabPane name="accounts" :tab="`账号管理 (${accounts.length})`">
              <div class="mb-4 flex flex-wrap items-center gap-2">
                <NInput v-model:value="accountKeyword" clearable placeholder="搜索标签 / TeamID / 代理 / 错误信息" style="width: min(100%, 320px)" class="glass-input">
                  <template #prefix>
                    <SvgIcon icon="ri:search-line" class="text-white/30" />
                  </template>
                </NInput>
                <NSelect v-model:value="accountFilter" :options="accountFilterOptions" style="width: 132px" />
                <NButton size="small" secondary class="glass-btn" @click="refreshCurrentTab">
                  <SvgIcon icon="ri:refresh-line" class="mr-1" /> 刷新当前
                </NButton>
                <div class="ml-auto flex gap-2">
                  <NButton type="primary" size="small" class="accent-btn" @click="openCreateAccount">
                    <SvgIcon icon="ri:key-2-line" class="mr-1" /> 添加账号
                  </NButton>
                  <NButton size="small" secondary class="glass-btn" @click="fetchAccounts">刷新账号</NButton>
                </div>
              </div>
              <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div
                  v-for="acc in filteredAccounts"
                  :key="acc.id"
                  class="account-card rounded-xl border p-4 transition-all duration-200"
                  :class="acc.isActive
                    ? (acc.inCooldown
                      ? 'border-amber-500/20 bg-amber-500/[0.03] hover:border-amber-500/30'
                      : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15] hover:bg-white/[0.05]')
                    : 'border-red-500/20 bg-red-500/[0.03] hover:border-red-500/30'"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <!-- Status indicator dot -->
                        <div class="relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                          :class="acc.isActive ? 'bg-gradient-to-br from-violet-500 to-indigo-600' : 'bg-gradient-to-br from-gray-500 to-gray-600'"
                        >
                          {{ acc.label.charAt(0).toUpperCase() }}
                          <div class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#1a1a2e]"
                            :class="acc.inCooldown ? 'bg-amber-400 animate-pulse' : acc.isActive ? 'bg-emerald-400' : 'bg-gray-400'"
                          />
                        </div>
                        <span class="truncate text-sm font-semibold text-white/90">{{ acc.label }}</span>
                        <NTag :type="acc.isActive ? 'success' : 'error'" size="tiny" round :bordered="false">{{ acc.isActive ? '活跃' : '停用' }}</NTag>
                        <NTag v-if="acc.inCooldown" type="warning" size="tiny" round :bordered="false">冷却中</NTag>
                        <NTag v-if="acc.batchResting" type="info" size="tiny" round :bordered="false">批次休息 {{ Math.ceil(acc.batchRestTtl / 60) }}分钟</NTag>
                        <NTag v-else-if="acc.batchLimit > 0" size="tiny" round :bordered="false">{{ acc.batchCount }}/{{ acc.batchLimit }}</NTag>
                        <NTag v-if="acc.priority > 0" type="info" size="tiny" round :bordered="false">优先级 {{ acc.priority }}</NTag>
                      </div>
                      <div class="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-white/35">
                        <span>Token: <span class="text-white/50">...{{ acc.tokenShort }}</span></span>
                        <span>TeamID: <span class="text-white/50">{{ acc.teamId }}</span></span>
                        <span>总生成: <b class="text-white/70">{{ acc.totalGenerated }}</b></span>
                        <span>近1h: <b :class="acc.hourlyGenerated > 0 ? 'text-emerald-400' : 'text-white/30'">{{ acc.hourlyGenerated }}</b></span>
                        <span>并发: <b :class="acc.currentConcurrency >= acc.maxConcurrency ? 'text-orange-400' : 'text-emerald-400'">{{ acc.currentConcurrency }}</b>/{{ acc.maxConcurrency }}</span>
                        <span class="col-span-2 truncate" v-if="acc.proxyUrl">代理: <span class="text-white/50">{{ acc.proxyUrl }}</span></span>
                        <span class="col-span-2" v-if="acc.activeTasks && acc.activeTasks.length > 0">用户: <b class="text-violet-400">{{ acc.activeTasks.map(t => t.username).filter((v,i,a) => a.indexOf(v)===i).join(', ') }}</b></span>
                      </div>
                      <div class="mt-2.5">
                        <NProgress
                          type="line"
                          :percentage="acc.maxConcurrency > 0 ? Math.round(acc.currentConcurrency / acc.maxConcurrency * 100) : 0"
                          :status="acc.currentConcurrency >= acc.maxConcurrency ? 'warning' : 'success'"
                          :show-indicator="false"
                          :height="4"
                        />
                      </div>
                      <div v-if="acc.lastErrorMessage" class="mt-2.5 rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-xs text-red-300/80">
                        <SvgIcon icon="ri:error-warning-line" class="mr-1 inline-block text-red-400" />
                        最近错误: {{ acc.lastErrorMessage }} ({{ acc.lastErrorAt ? formatTime(acc.lastErrorAt) : '' }})
                      </div>
                    </div>
                    <div class="flex flex-col gap-1">
                      <NButton size="tiny" tertiary :loading="accountTesting === acc.id" @click="testAccount(acc.id)">测试</NButton>
                      <NButton v-if="acc.inCooldown" size="tiny" tertiary type="warning" @click="resetCooldown(acc.id)">解除冷却</NButton>
                      <NButton v-if="acc.batchResting" size="tiny" tertiary type="info" @click="resetBatch(acc.id)">解除休息</NButton>
                      <NButton size="tiny" tertiary @click="openEditAccount(acc)">编辑</NButton>
                      <NButton size="tiny" tertiary :type="acc.isActive ? 'warning' : 'success'" @click="toggleAccountActive(acc)">{{ acc.isActive ? '停用' : '启用' }}</NButton>
                      <NButton size="tiny" tertiary type="error" @click="deleteAccount(acc.id)">移除</NButton>
                    </div>
                  </div>
                </div>
              </div>
              <div v-if="filteredAccounts.length === 0 && !accountsLoading" class="py-12 text-center text-sm text-white/20">
                <SvgIcon icon="ri:inbox-line" class="mx-auto mb-2 text-3xl text-white/10" />
                没有匹配的账号记录
              </div>
            </NTabPane>

            <NTabPane name="proxies" :tab="`代理池 (${proxies.length})`">
              <div class="mb-4 flex flex-wrap items-center gap-2">
                <div class="ml-auto flex gap-2">
                  <NButton type="primary" size="small" class="accent-btn" @click="openCreateProxy">
                    <SvgIcon icon="ri:add-line" class="mr-1" /> 添加代理
                  </NButton>
                  <NButton size="small" secondary class="glass-btn" @click="fetchProxies">刷新</NButton>
                </div>
              </div>
              <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div
                  v-for="pr in proxies"
                  :key="pr.id"
                  class="account-card rounded-xl border p-4 transition-all duration-200"
                  :class="pr.isActive ? 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15]' : 'border-red-500/20 bg-red-500/[0.03]'"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="truncate text-sm font-semibold text-white/90">{{ pr.label }}</span>
                        <NTag :type="pr.isActive ? 'success' : 'error'" size="tiny" round :bordered="false">{{ pr.isActive ? '启用' : '停用' }}</NTag>
                        <NTag v-if="pr.lastOk === true" type="success" size="tiny" round :bordered="false">可用 {{ pr.latencyMs }}ms</NTag>
                        <NTag v-else-if="pr.lastOk === false" type="error" size="tiny" round :bordered="false">不可用</NTag>
                        <NTag v-else size="tiny" round :bordered="false">未测试</NTag>
                        <NTag v-if="pr.accountCount > 0" type="info" size="tiny" round :bordered="false">{{ pr.accountCount }} 账号使用</NTag>
                      </div>
                      <div class="mt-2 text-xs text-white/50 break-all">{{ pr.url }}</div>
                      <div v-if="pr.lastError" class="mt-2 text-xs text-red-300/70">错误: {{ pr.lastError }}</div>
                      <div v-if="pr.lastTestedAt" class="mt-1 text-[11px] text-white/30">最近测试: {{ formatTime(pr.lastTestedAt) }}</div>
                    </div>
                    <div class="flex flex-col gap-1">
                      <NButton size="tiny" tertiary :loading="proxyTesting === pr.id" @click="testProxy(pr.id)">测试</NButton>
                      <NButton size="tiny" tertiary @click="openEditProxy(pr)">编辑</NButton>
                      <NButton size="tiny" tertiary type="error" @click="deleteProxy(pr.id)">删除</NButton>
                    </div>
                  </div>
                </div>
              </div>
              <div v-if="proxies.length === 0 && !proxiesLoading" class="py-12 text-center text-sm text-white/20">
                <SvgIcon icon="ri:inbox-line" class="mx-auto mb-2 text-3xl text-white/10" />
                代理池为空，点击上方“添加代理”
              </div>
            </NTabPane>

            <!-- Users Tab -->
            <NTabPane name="users" :tab="`用户管理 (${users.length})`">
              <div class="mb-4 flex flex-wrap items-center gap-2">
                <NInput v-model:value="userKeyword" clearable placeholder="搜索用户名或角色" style="width: min(100%, 280px)" class="glass-input">
                  <template #prefix>
                    <SvgIcon icon="ri:search-line" class="text-white/30" />
                  </template>
                </NInput>
                <NSelect v-model:value="userFilter" :options="userStatusFilterOptions" style="width: 132px" />
                <span class="text-xs text-white/30">共 {{ filteredUsers.length }} 条</span>
                <div class="ml-auto flex gap-2">
                  <NButton type="primary" size="small" class="accent-btn" @click="openCreateUser">
                    <SvgIcon icon="ri:user-add-line" class="mr-1" /> 新建用户
                  </NButton>
                  <NButton size="small" secondary class="glass-btn" @click="fetchUsers">刷新用户</NButton>
                </div>
              </div>
              <div class="table-shell overflow-hidden rounded-xl border border-white/[0.08]">
                <NDataTable :columns="userColumns" :data="filteredUsers" :loading="userLoading" :scroll-x="900" size="small" />
              </div>
            </NTabPane>

            <!-- Jobs Tab -->
            <NTabPane name="jobs" :tab="`任务监控 (${adminJobsTotal})`">
              <div class="mb-4 flex flex-wrap items-center gap-2">
                <NSelect v-model:value="jobsUser" :options="userFilterOptions" size="small" style="width: 150px" @update:value="onJobsFilterChange" />
                <NSelect v-model:value="jobsStatus" :options="statusOptions" size="small" style="width: 150px" @update:value="onJobsFilterChange" />
                <NButton size="small" secondary class="glass-btn" @click="onJobsFilterChange">应用筛选</NButton>
                <NButton size="small" quaternary @click="jobsUser = ''; jobsStatus = ''; onJobsFilterChange()">重置</NButton>
                <span class="ml-auto text-xs text-white/30">当前页 {{ jobsPage }} / {{ Math.ceil(adminJobsTotal / 20) || 1 }}</span>
              </div>
              <div class="table-shell overflow-hidden rounded-xl border border-white/[0.08]">
                <NDataTable :columns="jobColumns" :data="adminJobs" :loading="jobsLoading" :scroll-x="800" size="small" />
              </div>
              <div class="mt-4 flex justify-center">
                <NPagination v-model:page="jobsPage" :page-count="Math.ceil(adminJobsTotal / 20) || 1" />
              </div>
            </NTabPane>

            <!-- Logs Tab -->
            <NTabPane name="logs" :tab="`审计日志 (${logsTotal})`">
              <div class="mb-4 flex flex-wrap items-center gap-2">
                <NSelect v-model:value="logsAction" :options="logActionOptions" size="small" style="width: 150px" @update:value="onLogsFilterChange" />
                <NButton size="small" secondary class="glass-btn" @click="fetchLogs">刷新日志</NButton>
                <NButton size="small" quaternary @click="logsAction = ''; onLogsFilterChange()">重置</NButton>
                <span class="ml-auto text-xs text-white/30">当前页 {{ logsPage }} / {{ Math.ceil(logsTotal / 20) || 1 }}</span>
              </div>
              <div class="table-shell overflow-hidden rounded-xl border border-white/[0.08]">
                <NDataTable :columns="logColumns" :data="logs" :loading="logsLoading" :scroll-x="700" size="small" />
              </div>
              <div class="mt-4 flex justify-center">
                <NPagination v-model:page="logsPage" :page-count="Math.ceil(logsTotal / 20) || 1" />
              </div>
            </NTabPane>

            <!-- Devices Tab -->
            <NTabPane name="devices" :tab="`设备管理 (${devices.length})`">
              <div class="mb-4 flex flex-wrap items-center gap-2">
                <NTag type="warning" size="small" round :bordered="false">可疑登录 {{ suspiciousSessions.length }}</NTag>
                <NTag type="error" size="small" round :bordered="false">封禁设备 {{ blockedDeviceCount }}</NTag>
                <div class="ml-auto flex gap-2">
                  <NButton size="small" secondary class="glass-btn" @click="fetchDevices">刷新设备</NButton>
                  <NButton size="small" secondary class="glass-btn" @click="fetchSuspiciousSessions">刷新可疑登录</NButton>
                </div>
              </div>

              <!-- Devices table -->
              <div class="mb-3 flex items-center gap-2">
                <SvgIcon icon="ri:device-line" class="text-sm text-violet-400" />
                <p class="text-xs font-bold uppercase tracking-wider text-white/50">已注册设备</p>
              </div>
              <div class="table-shell mb-5 overflow-hidden rounded-xl border border-white/[0.08]">
                <NDataTable :columns="deviceColumns" :data="devices" :loading="devicesLoading" :scroll-x="900" size="small" />
              </div>

              <!-- Suspicious sessions -->
              <div class="mb-3 flex items-center gap-2">
                <SvgIcon icon="ri:alarm-warning-line" class="text-sm text-amber-400" />
                <p class="text-xs font-bold uppercase tracking-wider text-white/50">可疑登录记录</p>
              </div>
              <div class="table-shell overflow-hidden rounded-xl border border-white/[0.08]">
                <NDataTable :columns="sessionColumns" :data="suspiciousSessions" :loading="sessionsLoading" :scroll-x="800" size="small" />
              </div>
            </NTabPane>
            <!-- API Keys Tab -->
            <NTabPane name="apikeys" :tab="`API Keys (${apiKeys.length})`">
              <!-- Stats Overview -->
              <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div class="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-center">
                  <div class="text-2xl font-bold text-sky-400">{{ apiKeyStats.overall?.activeKeys || 0 }}</div>
                  <div class="text-xs text-white/40">活跃 Key</div>
                </div>
                <div class="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-center">
                  <div class="text-2xl font-bold text-emerald-400">{{ apiKeyStats.keys?.reduce((s: number, k: any) => s + (k.totalJobs || 0), 0) || 0 }}</div>
                  <div class="text-xs text-white/40">总调用次数</div>
                </div>
                <div class="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-center">
                  <div class="text-2xl font-bold text-amber-400">{{ apiKeyStats.keys?.reduce((s: number, k: any) => s + (k.jobsToday || 0), 0) || 0 }}</div>
                  <div class="text-xs text-white/40">今日调用</div>
                </div>
                <div class="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-center">
                  <div class="text-2xl font-bold text-rose-400">{{ apiKeyStats.keys?.reduce((s: number, k: any) => s + (k.active || 0), 0) || 0 }}</div>
                  <div class="text-xs text-white/40">进行中</div>
                </div>
              </div>

              <!-- Key Management -->
              <div class="mb-3 flex items-center gap-3">
                <NButton type="primary" size="small" @click="showCreateKeyModal = true">+ 创建 API Key</NButton>
              </div>

              <!-- Per-key Stats Table -->
              <div class="mb-4 table-shell overflow-hidden rounded-xl border border-white/[0.08]">
                <NDataTable :columns="apiKeyColumns" :data="apiKeys" :loading="apiKeysLoading" :scroll-x="900" size="small" />
              </div>

              <!-- Per-key Usage Stats -->
              <div v-if="apiKeyStats.keys?.length" class="mb-4">
                <h4 class="mb-2 text-sm font-medium text-white/60">各 Key 调用统计</h4>
                <div class="grid gap-2">
                  <div v-for="ks in apiKeyStats.keys" :key="ks.keyId" class="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs">
                    <div class="flex items-center gap-2">
                      <span class="font-mono text-sky-300">{{ ks.prefix }}</span>
                      <span class="text-white/50">{{ ks.keyName }}</span>
                      <span class="text-white/30">({{ ks.username }})</span>
                    </div>
                    <div class="flex gap-3">
                      <span class="text-white/40">总计 <span class="text-white/80">{{ ks.totalJobs }}</span></span>
                      <span class="text-white/40">今日 <span class="text-amber-300">{{ ks.jobsToday }}</span></span>
                      <span class="text-white/40">完成 <span class="text-emerald-300">{{ ks.completed }}</span></span>
                      <span class="text-white/40">失败 <span class="text-rose-300">{{ ks.failed }}</span></span>
                      <span class="text-white/40">进行中 <span class="text-sky-300">{{ ks.active }}</span></span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- API Documentation -->
              <div class="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                <h4 class="mb-3 text-sm font-medium text-white/70">API 调用方式</h4>
                <div class="space-y-3 text-xs">
                  <div>
                    <div class="mb-1 text-white/50">① 获取模型列表</div>
                    <pre class="overflow-x-auto rounded-lg bg-black/40 p-2 font-mono text-emerald-300/80">GET /v1/models
Authorization: Bearer sk-xxx</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-white/50">② 创建视频生成任务</div>
                    <pre class="overflow-x-auto rounded-lg bg-black/40 p-2 font-mono text-emerald-300/80">POST /v1/videos/generations
Authorization: Bearer sk-xxx
Content-Type: application/json

{
  "model": "kling-pro",
  "prompt": "描述文字",
  "duration": 5,
  "image_url": "https://...",
  "sound": true
}

模型: seedance-2.0 | kling-pro | kling-standard
参数: image_url(图生视频), image_urls(多参考图),
      video_url(参考视频), duration(5/10), sound, cfg_scale</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-white/50">③ 查询任务状态</div>
                    <pre class="overflow-x-auto rounded-lg bg-black/40 p-2 font-mono text-emerald-300/80">GET /v1/videos/generations/vgen_kling_xxx
Authorization: Bearer sk-xxx

状态: pending → processing → completed / failed
完成后 output.url 返回视频地址</pre>
                  </div>
                  <div>
                    <div class="mb-1 text-white/50">④ curl 示例</div>
                    <pre class="overflow-x-auto rounded-lg bg-black/40 p-2 font-mono text-sky-300/70"># 创建可灵视频 (Kling Pro)
curl -X POST http://101.35.158.183/v1/videos/generations \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"kling-pro","prompt":"一只猫在跑","duration":5}'

# 创建即梦视频 (Seedance 2.0)
curl -X POST http://101.35.158.183/v1/videos/generations \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"seedance-2.0","prompt":"日落海边沙滩漫步","duration":5}'

# 创建可灵标准版 (Kling Standard)
curl -X POST http://101.35.158.183/v1/videos/generations \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"kling-standard","prompt":"城市夜景延时","duration":5}'

# 图生视频 (任意模型均支持)
curl -X POST http://101.35.158.183/v1/videos/generations \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"seedance-2.0","prompt":"让画面动起来","image_url":"https://example.com/photo.jpg","duration":5}'

# 查询任务状态
curl http://101.35.158.183/v1/videos/generations/vgen_seedance_xxx \
  -H "Authorization: Bearer sk-xxx"</pre>
                  </div>
                </div>
              </div>
            </NTabPane>
          </NTabs>
        </div>
      </div>
    </NDrawerContent>
  </NDrawer>

  <!-- Create API Key Modal -->
  <NModal v-model:show="showCreateKeyModal" preset="card" title="创建 API Key" style="width: 480px" :bordered="true" :mask-closable="true">
    <NForm label-placement="left" label-width="80">
      <NFormItem label="名称">
        <NInput v-model:value="newKeyName" placeholder="例如: 测试Key" />
      </NFormItem>
      <NFormItem label="用户ID">
        <NInput v-model:value="newKeyUserId" placeholder="UUID格式的用户ID" />
        <div class="ml-2 text-xs text-white/40">
          <NSelect
            :options="users.map(u => ({ label: u.username, value: u.id }))"
            placeholder="或选择用户"
            filterable
            size="small"
            style="width: 160px"
            @update:value="(v: string) => newKeyUserId = v"
          />
        </div>
      </NFormItem>
      <NFormItem label="频率限制">
        <NInputNumber v-model:value="newKeyRateLimit" :min="1" :max="10000" />
        <span class="ml-2 text-xs text-white/40">次/分钟</span>
      </NFormItem>
    </NForm>
    <div v-if="createdKeyValue" class="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
      <div class="mb-1 text-xs text-emerald-400">API Key 已创建（仅显示一次，请立即复制）：</div>
      <div class="break-all font-mono text-sm text-emerald-300">{{ createdKeyValue }}</div>
      <NButton size="tiny" class="mt-2" @click="navigator.clipboard.writeText(createdKeyValue); ms.success('已复制')">复制</NButton>
    </div>
    <div class="flex justify-end gap-2">
      <NButton @click="showCreateKeyModal = false; createdKeyValue = ''">关闭</NButton>
      <NButton type="primary" @click="createApiKey">创建</NButton>
    </div>
  </NModal>

  <!-- User create/edit modal -->
  <NModal v-model:show="showUserModal" preset="card" :title="editingUser ? '编辑用户' : '新建用户'" style="width: min(92vw, 480px)" class="admin-modal">
    <NForm label-placement="left" label-width="80" class="admin-form">
      <NFormItem label="用户名">
        <NInput v-model:value="userForm.username" :disabled="Boolean(editingUser)" placeholder="请输入用户名" />
      </NFormItem>
      <NFormItem :label="editingUser ? '重置密码' : '密码'">
        <NInput v-model:value="userForm.password" type="password" show-password-on="click" :placeholder="editingUser ? '不修改留空' : '请输入密码'" />
      </NFormItem>
      <NFormItem label="角色">
        <NSelect v-model:value="userForm.role" :options="roleOptions" />
      </NFormItem>
      <NFormItem label="启用状态">
        <div class="flex items-center gap-2">
          <NSwitch v-model:value="userForm.isActive" />
          <span class="text-xs text-white/40">{{ userForm.isActive ? '启用' : '停用' }}</span>
        </div>
      </NFormItem>
      <NFormItem label="并发上限">
        <NInputNumber v-model:value="userForm.maxConcurrency" :min="1" :max="20" clearable placeholder="留空使用默认值" style="width: 100%" />
      </NFormItem>
      <NFormItem label="日配额">
        <NInputNumber v-model:value="userForm.dailyQuota" :min="1" clearable placeholder="留空不限制" style="width: 100%" />
      </NFormItem>
      <NFormItem label="总配额">
        <NInputNumber v-model:value="userForm.totalQuota" :min="1" clearable placeholder="留空不限制" style="width: 100%" />
      </NFormItem>
    </NForm>
    <div class="flex justify-end gap-2 pt-2">
      <NButton @click="showUserModal = false">取消</NButton>
      <NButton type="primary" :loading="userSaving" class="accent-btn" @click="saveUser">保存</NButton>
    </div>
  </NModal>

  <!-- Account create/edit modal -->
  <NModal v-model:show="showAccountModal" preset="card" :title="editingAccount ? '编辑账号' : '添加账号'" style="width: min(92vw, 520px)" class="admin-modal">
    <NTabs v-if="!editingAccount" v-model:value="accountModalTab" type="segment" style="margin-bottom: 12px">
      <NTabPane name="login" tab="Runway登录" />
      <NTabPane name="manual" tab="手动填写" />
    </NTabs>

    <!-- Login tab -->
    <template v-if="!editingAccount && accountModalTab === 'login'">
      <NForm label-placement="left" label-width="90" class="admin-form">
        <NFormItem label="账号标签">
          <NInput v-model:value="accountForm.label" placeholder="可选，留空自动用用户名" />
        </NFormItem>
        <NFormItem label="邮箱">
          <NInput v-model:value="loginForm.email" placeholder="Runway 登录邮箱" />
        </NFormItem>
        <NFormItem label="密码">
          <NInput v-model:value="loginForm.password" type="password" show-password-on="click" placeholder="Runway 登录密码" />
        </NFormItem>
        <NFormItem label="选择代理">
          <NSelect :value="accountForm.proxyId" :options="proxySelectOptions" @update:value="(v) => { accountForm.proxyId = v; const pr = proxies.find(x => x.id === v); if (pr) loginForm.proxyUrl = pr.url }" placeholder="从代理池选择" />
        </NFormItem>
        <NFormItem label="代理地址">
          <NInput v-model:value="loginForm.proxyUrl" placeholder="socks5://user:pass@host:port" />
        </NFormItem>
        <NFormItem label="最大并发">
          <NInputNumber v-model:value="accountForm.maxConcurrency" :min="1" :max="10" style="width: 100%" />
        </NFormItem>
        <NFormItem label="优先级">
          <NInputNumber v-model:value="accountForm.priority" :min="0" :max="100" style="width: 100%" />
          <template #feedback>数值越大优先使用</template>
        </NFormItem>
      </NForm>
      <div class="flex justify-end gap-2 pt-2">
        <NButton @click="showAccountModal = false">取消</NButton>
        <NButton type="primary" :loading="loginLoading" class="accent-btn" @click="loginRunway">登录并添加</NButton>
      </div>
    </template>

    <!-- Manual / Edit tab -->
    <template v-else>
      <NForm label-placement="left" label-width="90" class="admin-form">
        <NFormItem label="账号标签">
          <NInput v-model:value="accountForm.label" placeholder="例如: 账号1、美区账号" />
        </NFormItem>
        <NFormItem label="API Token">
          <NInput v-model:value="accountForm.token" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" :placeholder="editingAccount ? '不修改留空' : 'Runway API Token (JWT)'" />
        </NFormItem>
        <NFormItem label="Team ID">
          <NInput v-model:value="accountForm.teamId" :placeholder="editingAccount ? accountForm.teamId || '不修改留空' : 'Runway Team ID'" />
        </NFormItem>
        <NFormItem label="选择代理">
          <NSelect :value="accountForm.proxyId" :options="proxySelectOptions" @update:value="onProxySelectChange" placeholder="从代理池选择（可留空手动填写）" />
        </NFormItem>
        <NFormItem label="代理地址">
          <NInput v-model:value="accountForm.proxyUrl" placeholder="可选，如 socks5://user:pass@host:port 或 http://host:port" />
        </NFormItem>
        <NFormItem label="最大并发">
          <NInputNumber v-model:value="accountForm.maxConcurrency" :min="1" :max="10" style="width: 100%" />
        </NFormItem>
        <NFormItem label="优先级">
          <NInputNumber v-model:value="accountForm.priority" :min="0" :max="100" style="width: 100%" />
          <template #feedback>数值越大优先使用</template>
        </NFormItem>
      </NForm>
      <div class="flex justify-end gap-2 pt-2">
        <NButton @click="showAccountModal = false">取消</NButton>
        <NButton type="primary" :loading="accountSaving" class="accent-btn" @click="saveAccount">保存</NButton>
      </div>
    </template>
  </NModal>

  <NModal v-model:show="showProxyModal" preset="card" :title="editingProxy ? '编辑代理' : '添加代理'" style="width: min(92vw, 480px)" class="admin-modal">
    <NForm label-placement="left" label-width="80" class="admin-form">
      <NFormItem label="标签">
        <NInput v-model:value="proxyForm.label" placeholder="例如: 美西-SOCKS5" />
      </NFormItem>
      <NFormItem label="URL">
        <NInput v-model:value="proxyForm.url" placeholder="socks5://user:pass@host:port 或 http://host:port" />
      </NFormItem>
      <NFormItem label="启用">
        <NSwitch v-model:value="proxyForm.isActive" />
      </NFormItem>
    </NForm>
    <div class="flex justify-end gap-2 pt-2">
      <NButton @click="showProxyModal = false">取消</NButton>
      <NButton type="primary" :loading="proxySaving" class="accent-btn" @click="saveProxy">保存</NButton>
    </div>
  </NModal>
</template>

<style scoped>
.runway-admin-panel {
  position: relative;
}

/* ── Hero section ── */
.panel-hero {
  position: relative;
  overflow: hidden;
}

.panel-hero::before {
  content: '';
  position: absolute;
  right: -80px;
  top: -80px;
  width: 280px;
  height: 280px;
  border-radius: 9999px;
  background: radial-gradient(circle, rgba(139, 92, 246, 0.12) 0%, rgba(139, 92, 246, 0) 70%);
  pointer-events: none;
}

.panel-hero::after {
  content: '';
  position: absolute;
  left: -40px;
  bottom: -40px;
  width: 180px;
  height: 180px;
  border-radius: 9999px;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.08) 0%, rgba(99, 102, 241, 0) 70%);
  pointer-events: none;
}

/* ── Metric chips ── */
.metric-chip {
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(10px);
  transition: border-color 0.2s ease, background 0.2s ease;
}

.metric-chip:hover {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
}

.metric-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.metric-value {
  margin-top: 6px;
  font-size: 22px;
  line-height: 1.2;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
}

.metric-hint {
  margin-top: 3px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
}

/* ── Dashboard cards ── */
.dash-card {
  transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
}

.dash-card:hover {
  transform: translateY(-3px);
  border-color: rgba(255, 255, 255, 0.15);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(139, 92, 246, 0.1);
}

/* ── Glass sections ── */
.glass-section {
  position: relative;
}

/* ── Tabs styling ── */
.admin-tabs :deep(.n-tabs-nav) {
  margin-bottom: 16px;
  padding: 4px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.admin-tabs :deep(.n-tabs-tab) {
  font-weight: 600;
  font-size: 13px;
  border-radius: 8px;
  transition: all 0.2s ease;
  padding: 6px 16px;
}

.admin-tabs :deep(.n-tabs-tab:hover) {
  background: rgba(255, 255, 255, 0.05);
}

.admin-tabs :deep(.n-tabs-tab--active) {
  background: rgba(139, 92, 246, 0.15) !important;
  color: rgb(196, 181, 253) !important;
}

.admin-tabs :deep(.n-tabs-bar) {
  background: rgb(139, 92, 246);
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.4);
}

/* ── Table styling ── */
.table-shell :deep(.n-data-table) {
  --n-td-color: transparent;
  --n-th-color: rgba(255, 255, 255, 0.03);
  --n-td-color-hover: rgba(139, 92, 246, 0.06);
  --n-th-text-color: rgba(255, 255, 255, 0.5);
  --n-td-text-color: rgba(255, 255, 255, 0.7);
  --n-border-color: rgba(255, 255, 255, 0.06);
  --n-th-font-weight: 600;
}

.table-shell :deep(.n-data-table-wrapper) {
  background: transparent;
}

.table-shell :deep(.n-data-table-tr:hover > .n-data-table-td) {
  background: rgba(139, 92, 246, 0.06) !important;
}

.table-shell :deep(.n-data-table-th) {
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.05em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
}

.table-shell :deep(.n-data-table-td) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04) !important;
}

/* ── Account cards ── */
.account-card {
  position: relative;
  overflow: hidden;
}

.account-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(139, 92, 246, 0.3), transparent);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.account-card:hover::before {
  opacity: 1;
}

/* ── Modal styling ── */
.admin-modal :deep(.n-card) {
  background: rgba(20, 20, 40, 0.95) !important;
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(139, 92, 246, 0.1);
}

.admin-modal :deep(.n-card-header) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.admin-modal :deep(.n-card-header__main) {
  color: rgba(255, 255, 255, 0.9);
  font-weight: 700;
}

/* ── Form styling in modals ── */
.admin-form :deep(.n-form-item-label__text) {
  color: rgba(255, 255, 255, 0.5) !important;
  font-weight: 500;
}

.admin-form :deep(.n-input),
.admin-form :deep(.n-input-number) {
  --n-color: rgba(255, 255, 255, 0.04);
  --n-color-focus: rgba(139, 92, 246, 0.08);
  --n-border: 1px solid rgba(255, 255, 255, 0.08);
  --n-border-hover: 1px solid rgba(139, 92, 246, 0.3);
  --n-border-focus: 1px solid rgba(139, 92, 246, 0.5);
  --n-text-color: rgba(255, 255, 255, 0.8);
  --n-placeholder-color: rgba(255, 255, 255, 0.2);
  --n-caret-color: rgb(139, 92, 246);
}

/* ── Button styles ── */
.accent-btn {
  background: linear-gradient(135deg, rgb(139, 92, 246), rgb(99, 102, 241)) !important;
  border: none !important;
  box-shadow: 0 2px 12px rgba(139, 92, 246, 0.3);
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}

.accent-btn:hover {
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.45);
  transform: translateY(-1px);
}

/* ── Drawer content ── */
.admin-drawer-content :deep(.n-drawer-body-content-wrapper) {
  background: linear-gradient(180deg, #0f0f1a 0%, #1a1a2e 50%, #0f0f1a 100%);
}

.admin-drawer-content :deep(.n-drawer-header) {
  background: rgba(15, 15, 26, 0.95);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(12px);
}

/* ── Dark scrollbar ── */
.admin-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: rgba(139, 92, 246, 0.3) transparent;
}

.admin-scrollbar::-webkit-scrollbar {
  width: 5px;
}

.admin-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.admin-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(139, 92, 246, 0.25);
  border-radius: 10px;
}

.admin-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(139, 92, 246, 0.45);
}

/* ── Pagination ── */
.runway-admin-panel :deep(.n-pagination .n-pagination-item) {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
}

.runway-admin-panel :deep(.n-pagination .n-pagination-item--active) {
  background: rgba(139, 92, 246, 0.2);
  border-color: rgba(139, 92, 246, 0.4);
  color: rgb(196, 181, 253);
}

/* ── Empty state icon ── */
.runway-admin-panel :deep(.n-data-table-empty) {
  --n-empty-text-color: rgba(255, 255, 255, 0.2);
}

/* ── NSelect overrides in dark context ── */
.runway-admin-panel :deep(.n-base-selection) {
  --n-color: rgba(255, 255, 255, 0.04);
  --n-border: 1px solid rgba(255, 255, 255, 0.08);
  --n-text-color: rgba(255, 255, 255, 0.7);
}

/* ── Progress bar tweaks ── */
.runway-admin-panel :deep(.n-progress-graph-line-fill) {
  border-radius: 4px;
}

.runway-admin-panel :deep(.n-progress-graph-line-rail) {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 4px;
}

/* Global speed card */
.speed-card { transition: box-shadow 0.3s ease, border-color 0.3s ease; }
.speed-big-number { font-size: 2.5rem; font-weight: 800; line-height: 1; color: #fff; letter-spacing: -0.02em; }
.speed-card-bg { background: linear-gradient(135deg, rgba(99,102,241,0.06), transparent 60%, rgba(16,185,129,0.04)); }
.speed-zone-slow { border-color: rgba(59,130,246,0.45) !important; box-shadow: 0 0 24px rgba(59,130,246,0.12); }
.speed-zone-slow .speed-big-number { color: #60a5fa; }
.speed-zone-normal { border-color: rgba(16,185,129,0.45) !important; box-shadow: 0 0 24px rgba(16,185,129,0.12); }
.speed-zone-normal .speed-big-number { color: #34d399; }
.speed-zone-fast { border-color: rgba(245,158,11,0.5) !important; box-shadow: 0 0 24px rgba(245,158,11,0.15); }
.speed-zone-fast .speed-big-number { color: #fbbf24; }
.speed-zone-extreme { border-color: rgba(239,68,68,0.55) !important; box-shadow: 0 0 28px rgba(239,68,68,0.2); }
.speed-zone-extreme .speed-big-number { color: #f87171; }
@keyframes speedPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.05); }
}
.speed-pulse { animation: speedPulse 1.6s ease-in-out infinite; }
</style>
