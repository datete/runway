<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { NButton, NCheckbox, NEmpty, NModal, NPagination, NProgress, NSpin, NTag, useMessage } from 'naive-ui'
import { homeStore } from '@/store'
import { useRunwayJwt } from '@/composables/useRunwayJwt'
import RunwayAdminPanel from './RunwayAdminPanel.vue'
import RunwayLoginModal from './RunwayLoginModal.vue'

interface RunwayJob {
  id: string
  prompt: string
  remark: string | null
  mode: string
  status: string
  duration: number | null
  resultUrl: string | null
  thumbnailUrl: string | null
  errorMessage: string | null
  usedToken: string | null
  imageUrl: string | null
  referenceImages: string | null
  modelName: string
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
  queuePosition: number | null
  queueTotal: number | null
  progress: number | null
  username?: string | null
}

type TabKey = 'all' | 'queued' | 'processing' | 'completed' | 'failed'

const message = useMessage()
const { headers: authHeaders, token: jwtToken, role: jwtRole, username: jwtUsername, removeToken } = useRunwayJwt()

const showLoginModal = ref(!jwtToken.value)
const showAdminPanel = ref(false)
const allJobs = ref<RunwayJob[]>([])
const page = ref(1)
const pageSize = 10
const activeTab = ref<TabKey>('all')

const selectMode = ref(false)
const selected = ref<Set<string>>(new Set())
const showConfirm = ref(false)
const deleting = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'queued', label: '排队中' },
  { key: 'processing', label: '处理中' },
  { key: 'completed', label: '已完成' },
  { key: 'failed', label: '失败' },
]

const statusLabel: Record<string, string> = {
  pending: '等待中',
  queued: '排队中',
  submitted: '已提交',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const statusType: Record<string, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  pending: 'default',
  queued: 'default',
  submitted: 'info',
  processing: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
}

const modeLabel: Record<string, string> = {
  text_to_video: '文生视频',
  image_to_video: '图生视频',
  text2video: '文生视频',
  img2video: '图生视频',
}

const isQueued = (status: string) => ['pending', 'queued'].includes(status)
const isProcessing = (status: string) => ['submitted', 'processing'].includes(status)
const isActive = (status: string) => isQueued(status) || isProcessing(status)

const tabCount = computed(() => ({
  all: allJobs.value.length,
  queued: allJobs.value.filter((item) => isQueued(item.status)).length,
  processing: allJobs.value.filter((item) => isProcessing(item.status)).length,
  completed: allJobs.value.filter((item) => item.status === 'completed').length,
  failed: allJobs.value.filter((item) => item.status === 'failed').length,
}))

const filteredJobs = computed(() => {
  if (activeTab.value === 'queued') return allJobs.value.filter((item) => isQueued(item.status))
  if (activeTab.value === 'processing') return allJobs.value.filter((item) => isProcessing(item.status))
  if (activeTab.value === 'completed') return allJobs.value.filter((item) => item.status === 'completed')
  if (activeTab.value === 'failed') return allJobs.value.filter((item) => item.status === 'failed')
  return allJobs.value
})

const paginatedJobs = computed(() => {
  const start = (page.value - 1) * pageSize
  return filteredJobs.value.slice(start, start + pageSize)
})

const selectedJobs = computed(() => allJobs.value.filter((job) => selected.value.has(job.id)))

const allPageSelected = computed(
  () => paginatedJobs.value.length > 0 && paginatedJobs.value.every((job) => selected.value.has(job.id)),
)

const getFirstImage = (job: RunwayJob) => {
  if (job.referenceImages) {
    try {
      const parsed = JSON.parse(job.referenceImages)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed[0]
    } catch {
      // 忽略解析失败
    }
  }
  return job.imageUrl || null
}

const queuePosition = (job: RunwayJob) => job.queuePosition || null

const formatTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false })

const formatElapsed = (job: RunwayJob) => {
  if (!job.startedAt || !job.finishedAt) return ''
  const seconds = Math.max(0, Math.round((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000))
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

const fetchJobs = async () => {
  if (!jwtToken.value) {
    showLoginModal.value = true
    return
  }

  try {
    const res = await fetch('/api/runway/jobs', { headers: authHeaders() })
    if (!res.ok) {
      if (res.status === 401) showLoginModal.value = true
      return
    }

    allJobs.value = await res.json()
    const hasActive = allJobs.value.some((item) => isActive(item.status))

    if (hasActive && !pollTimer) pollTimer = setInterval(fetchJobs, 5000)
    if (!hasActive) stopPolling()
  } catch {
    // 轮询失败时静默处理
  }
}

const switchTab = (tab: TabKey) => {
  activeTab.value = tab
  page.value = 1
  selected.value = new Set()
}

const toggleSelect = (id: string) => {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

const toggleSelectAll = () => {
  const next = new Set(selected.value)
  if (allPageSelected.value) paginatedJobs.value.forEach((job) => next.delete(job.id))
  else paginatedJobs.value.forEach((job) => next.add(job.id))
  selected.value = next
}

const cancelSelectMode = () => {
  selectMode.value = false
  selected.value = new Set()
}

const confirmBulkDelete = () => {
  if (selected.value.size === 0) return
  showConfirm.value = true
}

const deleteSingle = (id: string) => {
  selected.value = new Set([id])
  showConfirm.value = true
}

const doDelete = async (ids: string[]) => {
  deleting.value = true
  let successCount = 0

  for (const id of ids) {
    try {
      const res = await fetch(`/api/runway/jobs/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (res.ok) {
        successCount += 1
        allJobs.value = allJobs.value.filter((job) => job.id !== id)
      }
    } catch {
      // 单条失败继续后续删除
    }
  }

  deleting.value = false
  showConfirm.value = false
  selected.value = new Set()
  selectMode.value = false
  message.success(`已删除 ${successCount} 条任务`)
}

const retryJob = async (id: string) => {
  try {
    const res = await fetch(`/api/runway/jobs/${id}/retry`, {
      method: 'POST',
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error('重试失败')
    message.success('任务已重新提交')
    fetchJobs()
  } catch (error: any) {
    message.error(error.message || '重试失败')
  }
}

const cancelJob = async (id: string) => {
  try {
    const res = await fetch(`/api/runway/jobs/${id}/cancel`, {
      method: 'POST',
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error('取消失败')
    message.success('任务已取消')
    fetchJobs()
  } catch (error: any) {
    message.error(error.message || '取消失败')
  }
}

const downloadVideo = async (job: RunwayJob) => {
  if (!job.resultUrl) return
  try {
    const res = await fetch(job.resultUrl)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `video-${job.id.slice(0, 8)}.mp4`
    anchor.click()
    URL.revokeObjectURL(objectUrl)
  } catch {
    window.open(job.resultUrl, '_blank')
  }
}

const handleLogout = () => {
  removeToken()
  allJobs.value = []
  selected.value = new Set()
  stopPolling()
  showLoginModal.value = true
}

watch(
  () => homeStore.myData.act,
  (act) => {
    if (act === 'RunwayMvpRefresh') {
      fetchJobs()
      page.value = 1
    }
    if (act === 'ShowAdmin') {
      showAdminPanel.value = true
    }
  },
)

watch(jwtToken, (token) => {
  showLoginModal.value = !token
  if (token) fetchJobs()
  else stopPolling()
})

onMounted(() => fetchJobs())
onUnmounted(() => stopPolling())
</script>

<template>
  <RunwayLoginModal v-model:show="showLoginModal" @loggedIn="fetchJobs" />
  <RunwayAdminPanel v-model:show="showAdminPanel" />

  <div
    class="min-h-[280px] rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/95"
  >
    <div v-if="!jwtToken" class="flex h-64 flex-col items-center justify-center gap-3">
      <p class="text-sm text-slate-500 dark:text-slate-400">请先登录后查看任务列表</p>
      <NButton type="primary" @click="showLoginModal = true">去登录</NButton>
    </div>

    <template v-else>
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/80">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{{ jwtUsername }}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ jwtRole === 'admin' ? '管理员账号' : '普通账号' }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <NButton v-if="jwtRole === 'admin'" size="small" @click="showAdminPanel = true">管理后台</NButton>
          <NButton size="small" quaternary @click="handleLogout">退出登录</NButton>
        </div>
      </div>

      <div class="mb-3 grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-800 sm:grid-cols-4">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="rounded-lg px-2 py-2 text-xs font-medium transition"
          :class="
            activeTab === tab.key
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-50'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          "
          @click="switchTab(tab.key)"
        >
          <span>{{ tab.label }}</span>
          <span v-if="tabCount[tab.key] > 0" class="ml-1 opacity-70">{{ tabCount[tab.key] }}</span>
        </button>
      </div>

      <div class="mb-3 flex items-center justify-between">
        <p class="text-xs text-slate-500 dark:text-slate-400">当前共 {{ filteredJobs.length }} 条任务</p>

        <div class="flex items-center gap-2">
          <template v-if="selectMode">
            <NCheckbox
              :checked="allPageSelected"
              :indeterminate="selected.size > 0 && !allPageSelected"
              @update:checked="toggleSelectAll"
            >
              全选当前页
            </NCheckbox>
            <NButton v-if="selected.size > 0" size="small" type="error" @click="confirmBulkDelete">
              删除 {{ selected.size }} 条
            </NButton>
            <NButton size="small" @click="cancelSelectMode">取消</NButton>
          </template>
          <template v-else>
            <NButton size="small" @click="selectMode = true">批量选择</NButton>
          </template>
        </div>
      </div>

      <NEmpty v-if="filteredJobs.length === 0" class="my-10" description="暂无任务数据" />

      <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="job in paginatedJobs"
          :key="job.id"
          class="overflow-hidden rounded-2xl border bg-white dark:bg-slate-950/65"
          :class="selected.has(job.id) ? 'border-cyan-500' : 'border-slate-200 dark:border-slate-800'"
        >
          <div
            v-if="selectMode"
            class="flex cursor-pointer items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800"
            @click="toggleSelect(job.id)"
          >
            <NCheckbox :checked="selected.has(job.id)" @update:checked="() => toggleSelect(job.id)" />
            <p class="truncate text-xs text-slate-500 dark:text-slate-400">{{ job.remark || job.prompt }}</p>
          </div>

          <div v-if="job.resultUrl" class="bg-black">
            <video controls loop preload="metadata" class="aspect-video w-full object-contain" :src="job.resultUrl" />
          </div>

          <div
            v-else-if="isActive(job.status)"
            class="relative aspect-video w-full overflow-hidden bg-slate-100 dark:bg-slate-900"
          >
            <img
              v-if="getFirstImage(job)"
              :src="getFirstImage(job) as string"
              class="h-full w-full object-cover opacity-70"
            />
            <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
              <div class="flex items-center gap-2">
                <NSpin size="small" />
                <span class="text-sm text-white">{{ statusLabel[job.status] || job.status }}</span>
                <span v-if="isQueued(job.status) && queuePosition(job) !== null" class="text-xs text-cyan-200">第 {{ queuePosition(job) }}/{{ job.queueTotal || '?' }} 位</span>
                <span v-if="isProcessing(job.status)" class="text-xs text-cyan-200">{{ job.progress != null && job.progress > 0 ? Math.round(job.progress * 100) + '%' : '处理中...' }}</span>
              </div>
              <NProgress v-if="isProcessing(job.status)" type="line" :percentage="Math.round((job.progress || 0) * 100)" :show-indicator="false" :height="3" status="success" class="mt-1" />
            </div>
          </div>

          <div class="p-3">
            <p v-if="job.remark" class="mb-1 text-xs font-medium text-cyan-600 dark:text-cyan-400"># {{ job.remark }}</p>

            <div class="mb-2 flex items-start justify-between gap-2">
              <p class="flex-1 break-words text-sm text-slate-700 dark:text-slate-200 line-clamp-3">
                {{ job.prompt }}
              </p>
              <NTag :type="statusType[job.status] || 'default'" size="small" round>
                {{ statusLabel[job.status] || job.status }}
              </NTag>
            </div>

            <div class="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span v-if="job.username" class="rounded bg-cyan-50 px-1.5 py-0.5 font-medium text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400">{{ job.username }}</span>
              <span>{{ formatTime(job.createdAt) }}</span>
              <span class="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                {{ modeLabel[job.mode] || job.mode }}
              </span>
              <span v-if="job.duration" class="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                {{ job.duration }} 秒
              </span>
              <span v-if="formatElapsed(job)">耗时 {{ formatElapsed(job) }}</span>
            </div>

            <div
              v-if="job.errorMessage"
              class="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-600 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300"
            >
              {{ job.errorMessage }}
            </div>

            <div class="flex flex-wrap justify-end gap-1.5">
              <NButton v-if="job.resultUrl" size="small" @click="downloadVideo(job)">下载视频</NButton>
              <NButton v-if="job.status === 'failed'" size="small" type="primary" @click="retryJob(job.id)">重新提交</NButton>
              <NButton
                v-if="!selectMode && isActive(job.status)"
                size="small"
                type="warning"
                secondary
                @click="cancelJob(job.id)"
              >
                取消任务
              </NButton>
              <NButton
                v-if="!selectMode && !isActive(job.status)"
                size="small"
                type="error"
                secondary
                @click="deleteSingle(job.id)"
              >
                删除任务
              </NButton>
            </div>
          </div>
        </div>

        <div v-if="filteredJobs.length > pageSize" class="flex justify-center pt-2">
          <NPagination v-model:page="page" :page-count="Math.ceil(filteredJobs.length / pageSize)" size="small" />
        </div>
      </div>
    </template>
  </div>

  <NModal
    v-model:show="showConfirm"
    preset="dialog"
    type="error"
    title="确认删除"
    :positive-text="deleting ? '删除中...' : `确认删除 ${selected.size} 条`"
    negative-text="取消"
    :positive-button-props="{ disabled: deleting, loading: deleting }"
    @positive-click="doDelete([...selected])"
    @negative-click="showConfirm = false"
  >
    <div class="space-y-2 py-1 text-sm text-slate-600 dark:text-slate-300">
      <p>
        即将删除 <span class="font-semibold text-rose-500">{{ selected.size }}</span> 条任务，删除后无法恢复。
      </p>
      <div class="max-h-44 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-2 dark:bg-slate-800/70">
        <div v-for="job in selectedJobs" :key="job.id" class="flex items-center gap-2 text-xs">
          <NTag :type="statusType[job.status] || 'default'" size="small" round>
            {{ statusLabel[job.status] || job.status }}
          </NTag>
          <span class="truncate text-slate-500 dark:text-slate-400">{{ job.remark || job.prompt }}</span>
        </div>
      </div>
    </div>
  </NModal>
</template>
