<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  NButton, NDataTable, NDrawer, NDrawerContent, NForm, NFormItem,
  NInput, NInputNumber, NModal, NPagination, NProgress, NSelect,
  NSwitch, NTabPane, NTabs, NTag, useMessage,
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
  totalJobs: number; todayJobs: number; todayCompleted: number; todayFailed: number; currentActive: number
}
interface DashboardOverview {
  totalUsers: number; activeUsers: number; totalJobs: number; todayJobs: number
  queuedJobs: number; processingJobs: number; completedJobs: number; failedJobs: number
  totalAccounts: number; activeAccounts: number; totalMaxConcurrency: number; totalCurrentConcurrency: number
}
interface AccountInfo {
  id: string; label: string; tokenShort: string; teamId: string; proxyUrl: string | null
  maxConcurrency: number; currentConcurrency: number; isActive: boolean; priority: number
  inCooldown: boolean; totalGenerated: number; lastUsedAt: string | null
  lastErrorAt: string | null; lastErrorMessage: string | null
  tokenExpiresAt: string | null; createdAt: string ; activeTasks?: ActiveTask[]
}
interface ActiveTask {
  jobId: string; username: string; status: string; progress: number; prompt: string; createdAt: string
}
interface AccountStat {
  id: string; label: string; tokenShort: string; isActive: boolean
  maxConcurrency: number; currentConcurrency: number; totalGenerated: number; activeTasks?: ActiveTask[]
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
const overview = ref<DashboardOverview>({ totalUsers: 0, activeUsers: 0, totalJobs: 0, todayJobs: 0, queuedJobs: 0, processingJobs: 0, completedJobs: 0, failedJobs: 0, totalAccounts: 0, activeAccounts: 0, totalMaxConcurrency: 0, totalCurrentConcurrency: 0 })
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
const accountForm = ref({ label: '', token: '', teamId: '', proxyUrl: '', maxConcurrency: 2, priority: 0 })
const accountTesting = ref<string | null>(null)
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

/* ── Options ── */
const userFilterOptions = computed(() => [
  { label: '全部用户', value: '' },
  ...users.value.map(u => ({ label: u.username, value: u.id })),
])
const roleOptions = [{ label: '普通用户', value: 'user' }, { label: '管理员', value: 'admin' }]
const statusOptions = [{ label: '全部状态', value: '' }, { label: '等待中', value: 'pending' }, { label: '排队中', value: 'queued' }, { label: '处理中', value: 'processing' }, { label: '已完成', value: 'completed' }, { label: '失败', value: 'failed' }]
const logActionOptions = [{ label: '全部行为', value: '' }, { label: '登录', value: 'login' }, { label: '创建任务', value: 'create_job' }, { label: '删除任务', value: 'delete_job' }, { label: '重试任务', value: 'retry_job' }]

const statusType: Record<string, 'default' | 'info' | 'success' | 'warning' | 'error'> = { pending: 'default', queued: 'default', submitted: 'info', processing: 'info', completed: 'success', failed: 'error', cancelled: 'warning' }
const statusLabel: Record<string, string> = { pending: '等待中', queued: '排队中', submitted: '已提交', processing: '处理中', completed: '已完成', failed: '失败', cancelled: '已取消' }
const actionLabel: Record<string, string> = { login: '登录', create_job: '创建任务', delete_job: '删除任务', retry_job: '重试任务', cancel_job: '取消任务' }
const actionType: Record<string, 'default' | 'info' | 'success' | 'warning' | 'error'> = { login: 'info', create_job: 'success', delete_job: 'error', retry_job: 'warning', cancel_job: 'warning' }

/* ── Dashboard cards ── */
const dashCards = computed(() => [
  { icon: 'ri:group-line', label: '总用户', value: overview.value.totalUsers, sub: `活跃 ${overview.value.activeUsers}`, color: 'from-blue-500 to-cyan-500' },
  { icon: 'ri:movie-2-line', label: '总任务', value: overview.value.totalJobs, sub: `完成 ${overview.value.completedJobs}`, color: 'from-violet-500 to-purple-600' },
  { icon: 'ri:sparkling-2-line', label: '今日生成', value: overview.value.todayJobs, sub: `失败 ${overview.value.failedJobs}`, color: 'from-amber-500 to-orange-500' },
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

const refreshAll = () => { fetchDashboard(); fetchUsers(); fetchAccounts(); fetchAdminJobs(); fetchLogs(); fetchDevices(); fetchSuspiciousSessions() }

/* ── Account CRUD ── */
const openCreateAccount = () => {
  editingAccount.value = null
  accountForm.value = { label: '', token: '', teamId: '', proxyUrl: '', maxConcurrency: 2, priority: 0 }
  loginForm.value = { email: '', password: '', proxyUrl: '' }
  accountModalTab.value = 'login'
  showAccountModal.value = true
}

const openEditAccount = (acc: AccountInfo) => {
  editingAccount.value = acc
  accountForm.value = { label: acc.label, token: '', teamId: acc.teamId, proxyUrl: acc.proxyUrl || '', maxConcurrency: acc.maxConcurrency, priority: acc.priority }
  accountModalTab.value = 'manual'
  showAccountModal.value = true
}

const saveAccount = async () => {
  const f = accountForm.value
  if (!f.label.trim()) { message.error('请输入账号标签'); return }
  if (!editingAccount.value && (!f.token.trim() || !f.teamId.trim())) { message.error('新建账号时 Token 和 TeamID 必填'); return }

  accountSaving.value = true
  try {
    const payload: Record<string, unknown> = { label: f.label.trim(), maxConcurrency: f.maxConcurrency, priority: f.priority, proxyUrl: f.proxyUrl.trim() || null }
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
    <NDrawerContent closable>
      <template #header>
        <div class="flex items-center gap-2">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600">
            <SvgIcon icon="ri:dashboard-3-line" class="text-lg text-white" />
          </div>
          <div>
            <p class="text-base font-semibold">管理控制台</p>
            <p class="text-xs text-slate-400">用户管理 · 账号管理 · 任务监控 · 审计日志</p>
          </div>
        </div>
      </template>

      <div class="space-y-4">
        <!-- Dashboard overview cards -->
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div
            v-for="card in dashCards"
            :key="card.label"
            class="relative overflow-hidden rounded-xl border border-slate-200/80 bg-white p-3.5 dark:border-slate-700/50 dark:bg-slate-800/80"
          >
            <div class="absolute -right-2 -top-2 h-16 w-16 rounded-full bg-gradient-to-br opacity-10" :class="card.color" />
            <div class="flex items-start justify-between">
              <div>
                <p class="text-xs text-slate-500 dark:text-slate-400">{{ card.label }}</p>
                <p class="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{{ card.value }}</p>
                <p class="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{{ card.sub }}</p>
              </div>
              <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br text-white" :class="card.color">
                <SvgIcon :icon="card.icon" class="text-lg" />
              </div>
            </div>
          </div>
        </div>

        <!-- User stats cards -->
        <div v-if="userStats.length > 0" class="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-700/50 dark:bg-slate-800/80">
          <div class="mb-3 flex items-center justify-between">
            <p class="text-sm font-semibold text-slate-800 dark:text-slate-100">用户用量概览</p>
            <NButton size="tiny" quaternary @click="fetchDashboard">
              <SvgIcon icon="ri:refresh-line" class="mr-1" /> 刷新
            </NButton>
          </div>
          <div class="space-y-2">
            <div
              v-for="u in userStats"
              :key="u.id"
              class="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-2.5 dark:border-slate-700/40 dark:bg-slate-800/40"
            >
              <div
                class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                :class="u.role === 'admin' ? 'bg-gradient-to-br from-red-500 to-pink-500' : 'bg-gradient-to-br from-cyan-500 to-blue-500'"
              >
                {{ u.username.charAt(0).toUpperCase() }}
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="text-sm font-medium text-slate-800 dark:text-slate-100">{{ u.username }}</span>
                  <NTag :type="u.role === 'admin' ? 'error' : 'info'" size="tiny" round :bordered="false">{{ u.role === 'admin' ? '管理' : '用户' }}</NTag>
                  <NTag v-if="!u.isActive" type="warning" size="tiny" round :bordered="false">已停用</NTag>
                </div>
                <div class="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>总任务 <b class="text-slate-700 dark:text-slate-200">{{ u.totalJobs }}</b><template v-if="u.totalQuota !== null">/{{ u.totalQuota }}</template></span>
                  <span>今日 <b class="text-slate-700 dark:text-slate-200">{{ u.todayJobs }}</b><template v-if="u.dailyQuota !== null">/{{ u.dailyQuota }}</template></span>
                  <span>今日完成 <b class="text-emerald-600 dark:text-emerald-400">{{ u.todayCompleted }}</b></span>
                  <span v-if="u.todayFailed > 0">失败 <b class="text-red-500">{{ u.todayFailed }}</b></span>
                  <span>并发 <b :class="u.currentActive > 0 ? 'text-orange-500' : 'text-emerald-500'">{{ u.currentActive }}</b>/<b class="text-slate-700 dark:text-slate-200">{{ u.maxConcurrency ?? '不限' }}</b></span>
                </div>
              </div>
              <div v-if="u.totalQuota !== null" class="w-20 flex-shrink-0">
                <NProgress
                  type="line"
                  :percentage="Math.min(100, Math.round(u.totalJobs / u.totalQuota * 100))"
                  :status="u.totalJobs >= u.totalQuota ? 'error' : 'success'"
                  :show-indicator="false"
                  :height="6"
                />
                <p class="mt-0.5 text-center text-[10px] text-slate-400">{{ Math.round(u.totalJobs / u.totalQuota * 100) }}%</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Account stats (in dashboard area) -->
        <div v-if="accountStatsData.length > 0" class="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-700/50 dark:bg-slate-800/80">
          <div class="mb-3 flex items-center justify-between">
            <p class="text-sm font-semibold text-slate-800 dark:text-slate-100">账号并发概览</p>
            <NButton size="tiny" quaternary @click="fetchDashboard">
              <SvgIcon icon="ri:refresh-line" class="mr-1" /> 刷新
            </NButton>
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div
              v-for="a in accountStatsData"
              :key="a.id"
              class="overflow-hidden rounded-xl border"
              :class="a.isActive ? 'border-slate-200 dark:border-slate-700' : 'border-red-200 bg-red-50/30 dark:border-red-900/30 dark:bg-red-900/10'"
            >
              <div class="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-700/50" :class="a.isActive ? 'bg-slate-50/80 dark:bg-slate-800/60' : ''">
                <div class="flex items-center gap-2">
                  <div class="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white" :class="a.isActive ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-gradient-to-br from-red-400 to-red-500'">
                    {{ a.label.charAt(0).toUpperCase() }}
                  </div>
                  <span class="text-sm font-semibold text-slate-800 dark:text-slate-100">{{ a.label }}</span>
                  <NTag :type="a.isActive ? 'success' : 'warning'" size="tiny" round :bordered="false">{{ a.isActive ? '活跃' : '停用' }}</NTag>
                </div>
                <span class="text-[11px] text-slate-500">已生成 <b class="text-slate-700 dark:text-slate-300">{{ a.totalGenerated }}</b></span>
              </div>
              <div class="px-4 py-2">
                <div class="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>并发占用</span>
                  <span><b :class="a.currentConcurrency >= a.maxConcurrency ? 'text-orange-500' : 'text-emerald-600 dark:text-emerald-400'">{{ a.currentConcurrency }}</b> / {{ a.maxConcurrency }}</span>
                </div>
                <NProgress
                  type="line"
                  :percentage="a.maxConcurrency > 0 ? Math.round(a.currentConcurrency / a.maxConcurrency * 100) : 0"
                  :status="a.currentConcurrency >= a.maxConcurrency ? 'warning' : 'success'"
                  :show-indicator="false"
                  :height="6"
                  class="mt-1"
                />
              </div>
              <div v-if="a.activeTasks && a.activeTasks.length > 0" class="border-t border-slate-100 px-4 py-2 dark:border-slate-700/50">
                <p class="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">最近任务</p>
                <div class="space-y-1.5">
                  <div v-for="t in a.activeTasks" :key="t.jobId" class="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/60">
                    <div class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-cyan-100 text-[9px] font-bold text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300">
                      {{ t.username.charAt(0).toUpperCase() }}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                        <span class="text-[11px] font-medium text-cyan-600 dark:text-cyan-400">{{ t.username }}</span>
                        <span class="text-[10px] text-slate-400">#{{ t.jobId }}</span>
                        <NTag :type="t.status === 'completed' ? 'success' : t.status === 'failed' ? 'error' : t.status === 'cancelled' ? 'warning' : 'info'" size="tiny" round :bordered="false">
                          {{ {completed: '完成', failed: '失败', cancelled: '取消', processing: '生成中', submitted: '提交中', pending: '排队'}[t.status] || t.status }}
                        </NTag>
                      </div>
                      <p class="truncate text-[10px] text-slate-400">{{ t.prompt || '...' }}</p>
                    </div>
                    <div v-if="t.status === 'processing' && t.progress > 0" class="w-10 flex-shrink-0 text-right text-[11px] font-bold text-emerald-500">
                      {{ Math.round(t.progress * 100) }}%
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="border-t border-slate-100 px-4 py-2 dark:border-slate-700/50">
                <p class="text-center text-[11px] text-slate-300 dark:text-slate-600">暂无任务记录</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Tabs: Accounts / Users / Jobs / Logs -->
        <div class="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-700/50 dark:bg-slate-800/80">
          <NTabs type="segment" animated>
            <!-- Accounts Tab -->
            <NTabPane name="accounts" tab="账号管理">
              <div class="mb-3 flex gap-2">
                <NButton type="primary" size="small" @click="openCreateAccount">
                  <SvgIcon icon="ri:key-2-line" class="mr-1" /> 添加账号
                </NButton>
                <NButton size="small" secondary @click="fetchAccounts">刷新</NButton>
              </div>
              <div class="space-y-2">
                <div
                  v-for="acc in accounts"
                  :key="acc.id"
                  class="rounded-lg border p-3"
                  :class="acc.isActive ? 'border-slate-200 dark:border-slate-700' : 'border-red-200 bg-red-50/30 dark:border-red-900/30 dark:bg-red-900/10'"
                >
                  <div class="flex items-start justify-between">
                    <div class="flex-1">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-semibold text-slate-800 dark:text-slate-100">{{ acc.label }}</span>
                        <NTag :type="acc.isActive ? 'success' : 'error'" size="tiny" round :bordered="false">{{ acc.isActive ? '活跃' : '停用' }}</NTag>
                        <NTag v-if="acc.inCooldown" type="warning" size="tiny" round :bordered="false">冷却中</NTag>
                        <NTag v-if="acc.priority > 0" type="info" size="tiny" round :bordered="false">优先级 {{ acc.priority }}</NTag>
                      </div>
                      <div class="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-500 dark:text-slate-400">
                        <span>Token: ...{{ acc.tokenShort }}</span>
                        <span>TeamID: {{ acc.teamId }}</span>
                        <span v-if="acc.proxyUrl">代理: {{ acc.proxyUrl }}</span>
                        <span>并发: <b :class="acc.currentConcurrency >= acc.maxConcurrency ? 'text-orange-500' : 'text-emerald-500'">{{ acc.currentConcurrency }}</b>/{{ acc.maxConcurrency }}</span>
                        <span>总生成: <b class="text-slate-700 dark:text-slate-200">{{ acc.totalGenerated }}</b></span>
                        <span v-if="acc.activeTasks && acc.activeTasks.length > 0">用户: <b class="text-blue-500">{{ acc.activeTasks.map(t => t.username).filter((v,i,a) => a.indexOf(v)===i).join(", ") }}</b></span>
                      </div>
                      <div v-if="acc.lastErrorMessage" class="mt-1 text-xs text-red-500">
                        最近错误: {{ acc.lastErrorMessage }} ({{ acc.lastErrorAt ? formatTime(acc.lastErrorAt) : '' }})
                      </div>
                    </div>
                    <div class="flex gap-1">
                      <NButton size="tiny" tertiary :loading="accountTesting === acc.id" @click="testAccount(acc.id)">测试</NButton>
                      <NButton size="tiny" tertiary @click="openEditAccount(acc)">编辑</NButton>
                      <NButton size="tiny" tertiary :type="acc.isActive ? 'warning' : 'success'" @click="toggleAccountActive(acc)">{{ acc.isActive ? '停用' : '启用' }}</NButton>
                    </div>
                  </div>
                </div>
                <div v-if="accounts.length === 0 && !accountsLoading" class="py-8 text-center text-sm text-slate-400">
                  暂无账号，点击"添加账号"开始
                </div>
              </div>
            </NTabPane>

            <!-- Users Tab -->
            <NTabPane name="users" tab="用户管理">
              <div class="mb-3 flex gap-2">
                <NButton type="primary" size="small" @click="openCreateUser">
                  <SvgIcon icon="ri:user-add-line" class="mr-1" /> 新建用户
                </NButton>
                <NButton size="small" secondary @click="fetchUsers">刷新</NButton>
              </div>
              <div class="overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-700/40">
                <NDataTable :columns="userColumns" :data="users" :loading="userLoading" :scroll-x="900" size="small" />
              </div>
            </NTabPane>

            <!-- Jobs Tab -->
            <NTabPane name="jobs" tab="任务监控">
              <div class="mb-3 flex flex-wrap gap-2">
                <NSelect v-model:value="jobsUser" :options="userFilterOptions" size="small" style="width: 140px" @update:value="jobsPage = 1; fetchAdminJobs()" />
                <NSelect v-model:value="jobsStatus" :options="statusOptions" size="small" style="width: 140px" @update:value="jobsPage = 1; fetchAdminJobs()" />
                <NButton size="small" secondary @click="fetchAdminJobs">刷新</NButton>
              </div>
              <div class="overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-700/40">
                <NDataTable :columns="jobColumns" :data="adminJobs" :loading="jobsLoading" :scroll-x="800" size="small" />
              </div>
              <div class="mt-3 flex justify-center">
                <NPagination v-model:page="jobsPage" :page-count="Math.ceil(adminJobsTotal / 20) || 1" />
              </div>
            </NTabPane>

            <!-- Logs Tab -->
            <NTabPane name="logs" tab="审计日志">
              <div class="mb-3 flex flex-wrap gap-2">
                <NSelect v-model:value="logsAction" :options="logActionOptions" size="small" style="width: 140px" @update:value="logsPage = 1; fetchLogs()" />
                <NButton size="small" secondary @click="fetchLogs">刷新</NButton>
              </div>
              <div class="overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-700/40">
                <NDataTable :columns="logColumns" :data="logs" :loading="logsLoading" :scroll-x="700" size="small" />
              </div>
              <div class="mt-3 flex justify-center">
                <NPagination v-model:page="logsPage" :page-count="Math.ceil(logsTotal / 20) || 1" />
              </div>
            </NTabPane>

            <!-- Devices Tab -->
            <NTabPane name="devices" tab="设备管理">
              <div class="mb-3 flex gap-2">
                <NButton size="small" secondary @click="fetchDevices">刷新设备</NButton>
                <NButton size="small" secondary @click="fetchSuspiciousSessions">刷新可疑登录</NButton>
              </div>

              <!-- Devices table -->
              <p class="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">已注册设备</p>
              <div class="mb-4 overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-700/40">
                <NDataTable :columns="deviceColumns" :data="devices" :loading="devicesLoading" :scroll-x="900" size="small" />
              </div>

              <!-- Suspicious sessions -->
              <p class="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">可疑登录记录</p>
              <div class="overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-700/40">
                <NDataTable :columns="sessionColumns" :data="suspiciousSessions" :loading="sessionsLoading" :scroll-x="800" size="small" />
              </div>
            </NTabPane>
          </NTabs>
        </div>
      </div>
    </NDrawerContent>
  </NDrawer>

  <!-- User create/edit modal -->
  <NModal v-model:show="showUserModal" preset="card" :title="editingUser ? '编辑用户' : '新建用户'" style="width: min(92vw, 480px)">
    <NForm label-placement="left" label-width="80">
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
          <span class="text-xs text-slate-500">{{ userForm.isActive ? '启用' : '停用' }}</span>
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
    <div class="flex justify-end gap-2">
      <NButton @click="showUserModal = false">取消</NButton>
      <NButton type="primary" :loading="userSaving" @click="saveUser">保存</NButton>
    </div>
  </NModal>

  <!-- Account create/edit modal -->
  <NModal v-model:show="showAccountModal" preset="card" :title="editingAccount ? '编辑账号' : '添加账号'" style="width: min(92vw, 520px)">
    <NTabs v-if="!editingAccount" v-model:value="accountModalTab" type="segment" style="margin-bottom: 12px">
      <NTabPane name="login" tab="Runway登录" />
      <NTabPane name="manual" tab="手动填写" />
    </NTabs>

    <!-- Login tab -->
    <template v-if="!editingAccount && accountModalTab === 'login'">
      <NForm label-placement="left" label-width="90">
        <NFormItem label="账号标签">
          <NInput v-model:value="accountForm.label" placeholder="可选，留空自动用用户名" />
        </NFormItem>
        <NFormItem label="邮箱">
          <NInput v-model:value="loginForm.email" placeholder="Runway 登录邮箱" />
        </NFormItem>
        <NFormItem label="密码">
          <NInput v-model:value="loginForm.password" type="password" show-password-on="click" placeholder="Runway 登录密码" />
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
      <div class="flex justify-end gap-2">
        <NButton @click="showAccountModal = false">取消</NButton>
        <NButton type="primary" :loading="loginLoading" @click="loginRunway">登录并添加</NButton>
      </div>
    </template>

    <!-- Manual / Edit tab -->
    <template v-else>
      <NForm label-placement="left" label-width="90">
        <NFormItem label="账号标签">
          <NInput v-model:value="accountForm.label" placeholder="例如: 账号1、美区账号" />
        </NFormItem>
        <NFormItem label="API Token">
          <NInput v-model:value="accountForm.token" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" :placeholder="editingAccount ? '不修改留空' : 'Runway API Token (JWT)'" />
        </NFormItem>
        <NFormItem label="Team ID">
          <NInput v-model:value="accountForm.teamId" :placeholder="editingAccount ? accountForm.teamId || '不修改留空' : 'Runway Team ID'" />
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
      <div class="flex justify-end gap-2">
        <NButton @click="showAccountModal = false">取消</NButton>
        <NButton type="primary" :loading="accountSaving" @click="saveAccount">保存</NButton>
      </div>
    </template>
  </NModal>
</template>
