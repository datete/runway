<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
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
}
interface AdminLog {
  id: string; action: string; detail: string; ip: string
  createdAt: string; user?: { id: string; username: string }
}
interface UserStat {
  id: string; username: string; role: string; isActive: boolean
  maxConcurrency: number | null; dailyQuota: number | null; totalQuota: number | null
  totalJobs: number; todayJobs: number; todayCompleted: number; todayFailed: number
}
interface DashboardOverview {
  totalUsers: number; activeUsers: number; totalJobs: number; todayJobs: number
  queuedJobs: number; processingJobs: number; completedJobs: number; failedJobs: number
}

/* ── Props / Emits ── */
const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [v: boolean] }>()

const message = useMessage()
const { headers } = useRunwayJwt()

/* ── State ── */
const overview = ref<DashboardOverview>({ totalUsers: 0, activeUsers: 0, totalJobs: 0, todayJobs: 0, queuedJobs: 0, processingJobs: 0, completedJobs: 0, failedJobs: 0 })
const userStats = ref<UserStat[]>([])

const users = ref<AdminUser[]>([])
const userLoading = ref(false)
const showUserModal = ref(false)
const editingUser = ref<AdminUser | null>(null)
const userSaving = ref(false)
const userForm = ref({ username: '', password: '', role: 'user' as 'admin' | 'user', isActive: true, maxConcurrency: null as number | null, dailyQuota: null as number | null, totalQuota: null as number | null })

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

/* ── Options ── */
const userFilterOptions = computed(() => [
  { label: '全部用户', value: '' },
  ...users.value.map(u => ({ label: u.username, value: u.id })),
])
const roleOptions = [{ label: '普���用户', value: 'user' }, { label: '管理员', value: 'admin' }]
const statusOptions = [{ label: '全部状态', value: '' }, { label: '等待中', value: 'pending' }, { label: '排队中', value: 'queued' }, { label: '处理中', value: 'processing' }, { label: '已完成', value: 'completed' }, { label: '失败', value: 'failed' }]
const logActionOptions = [{ label: '全部行为', value: '' }, { label: '登录', value: 'login' }, { label: '创建任务', value: 'create_job' }, { label: '删���任务', value: 'delete_job' }, { label: '重试任务', value: 'retry_job' }]

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

const refreshAll = () => { fetchDashboard(); fetchUsers(); fetchAdminJobs(); fetchLogs() }

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
    if (!res.ok) throw new Error('删除失��')
    message.success('已删除')
    fetchUsers(); fetchDashboard()
  } catch (e: any) { message.error(e.message) }
}

/* ── Table columns ── */
const userColumns = [
  { title: '用户名', key: 'username', width: 120 },
  { title: '角色', key: 'role', width: 90, render: (row: AdminUser) => h(NTag, { type: row.role === 'admin' ? 'error' : 'info', size: 'small', round: true, bordered: false }, () => row.role === 'admin' ? '管理员' : '用���') },
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
  { title: '状态', key: 'status', width: 100, render: (row: AdminJob) => h(NTag, { type: statusType[row.status] ?? 'default', size: 'small', round: true, bordered: false }, () => statusLabel[row.status] || row.status) },
  { title: '时长', key: 'duration', width: 70, render: (row: AdminJob) => row.duration ? `${row.duration}s` : '—' },
  { title: '提示词', key: 'prompt', ellipsis: { tooltip: true } },
  { title: '时间', key: 'createdAt', width: 170, render: (row: AdminJob) => formatTime(row.createdAt) },
]

const logColumns = [
  { title: '用��', key: 'user', width: 100, render: (row: AdminLog) => h(NTag, { size: 'small', round: true, bordered: false, type: 'info' }, () => row.user?.username ?? '—') },
  { title: '行为', key: 'action', width: 110, render: (row: AdminLog) => h(NTag, { type: actionType[row.action] ?? 'default', size: 'small', round: true, bordered: false }, () => actionLabel[row.action] || row.action) },
  { title: '详情', key: 'detail', ellipsis: { tooltip: true } },
  { title: 'IP', key: 'ip', width: 140 },
  { title: '时���', key: 'createdAt', width: 170, render: (row: AdminLog) => formatTime(row.createdAt) },
]

/* ── Watchers ── */
watch(() => props.show, (v) => { if (v) refreshAll() })
watch(jobsPage, () => fetchAdminJobs())
watch(logsPage, () => fetchLogs())
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
            <p class="text-xs text-slate-400">用户管理 · 任务监控 · 审计日志</p>
          </div>
        </div>
      </template>

      <div class="space-y-4">
        <!-- Dashboard overview cards -->
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
              <!-- Avatar -->
              <div
                class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                :class="u.role === 'admin' ? 'bg-gradient-to-br from-red-500 to-pink-500' : 'bg-gradient-to-br from-cyan-500 to-blue-500'"
              >
                {{ u.username.charAt(0).toUpperCase() }}
              </div>
              <!-- Info -->
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
                  <span>并发上限 <b class="text-slate-700 dark:text-slate-200">{{ u.maxConcurrency ?? '默认' }}</b></span>
                </div>
              </div>
              <!-- Progress if has totalQuota -->
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

        <!-- Tabs: Users / Jobs / Logs -->
        <div class="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-700/50 dark:bg-slate-800/80">
          <NTabs type="segment" animated>
            <!-- Users Tab -->
            <NTabPane name="users" tab="用户管理">
              <div class="mb-3 flex gap-2">
                <NButton type="primary" size="small" @click="openCreateUser">
                  <SvgIcon icon="ri:user-add-line" class="mr-1" /> 新建��户
                </NButton>
                <NButton size="small" secondary @click="fetchUsers">刷���</NButton>
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
                <NDataTable :columns="jobColumns" :data="adminJobs" :loading="jobsLoading" :scroll-x="700" size="small" />
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
          </NTabs>
        </div>
      </div>
    </NDrawerContent>
  </NDrawer>

  <!-- User create/edit modal -->
  <NModal v-model:show="showUserModal" preset="card" :title="editingUser ? '编辑用户' : '新建用户'" style="width: min(92vw, 480px)">
    <NForm label-placement="left" label-width="80">
      <NFormItem label="���户名">
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
</template>
