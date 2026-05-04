<template>
  <div class="runway-queue-panel w-full h-full overflow-y-auto p-6">
    <!-- Stats Bar -->
    <div class="flex items-center gap-3 mb-5 flex-wrap">
      <div class="stats-chip stats-chip--default">
        <SvgIcon icon="ri:list-check-2" class="text-white/50 text-sm" />
        <span class="text-white/50 text-xs">总计</span>
        <span class="text-white font-bold text-base">{{ jobs.length }}</span>
      </div>
      <div class="stats-chip stats-chip--active" :class="{ 'glow-pulse': activeCount > 0 }">
        <SvgIcon icon="ri:loader-4-line" class="text-blue-400/70 text-sm" :class="{ 'animate-spin-slow': activeCount > 0 }" />
        <span class="text-blue-400/70 text-xs">进行中</span>
        <span class="text-blue-400 font-bold text-base">{{ activeCount }}</span>
      </div>
      <div class="stats-chip stats-chip--completed">
        <SvgIcon icon="ri:check-double-line" class="text-emerald-400/70 text-sm" />
        <span class="text-emerald-400/70 text-xs">已完成</span>
        <span class="text-emerald-400 font-bold text-base">{{ completedCount }}</span>
      </div>
      <div class="stats-chip stats-chip--failed">
        <SvgIcon icon="ri:error-warning-line" class="text-red-400/70 text-sm" />
        <span class="text-red-400/70 text-xs">失败</span>
        <span class="text-red-400 font-bold text-base">{{ failedCount }}</span>
      </div>
      <div class="ml-auto text-white/30 text-xs select-none">
        上次更新: {{ lastUpdatedDisplay }}
      </div>
    </div>

    <!-- Status Filter Tabs (Segmented Control) -->
    <div class="segmented-control mb-5">
      <div
        class="segmented-indicator"
        :style="indicatorStyle"
      />
      <button
        v-for="(tab, idx) in tabs"
        :key="tab.key"
        :ref="el => setTabRef(el, idx)"
        class="segmented-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
        <span
          v-if="tab.count > 0"
          class="segmented-badge"
          :class="activeTab === tab.key ? 'bg-white/25 text-white' : 'bg-white/10 text-white/50'"
        >{{ tab.count }}</span>
      </button>
    </div>

    <!-- Loading State: Skeleton Cards -->
    <div v-if="loading && jobs.length === 0" class="job-grid">
      <div v-for="n in 3" :key="n" class="skeleton-card">
        <div class="skeleton-line w-20 h-4 mb-4" />
        <div class="skeleton-line w-full h-4 mb-2" />
        <div class="skeleton-line w-3/4 h-4 mb-4" />
        <div class="skeleton-rect aspect-video mb-4" />
        <div class="flex gap-2">
          <div class="skeleton-line w-16 h-3" />
          <div class="skeleton-line w-12 h-3" />
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="filteredJobs.length === 0"
      class="flex flex-col items-center justify-center py-24 text-white/30"
    >
      <div class="empty-icon-wrapper">
        <SvgIcon icon="ri:vidicon-line" class="text-6xl opacity-50" />
      </div>
      <p class="text-lg mt-5 font-medium text-white/40">暂无任务</p>
      <p class="text-sm mt-2 text-white/25">当前筛选条件下没有任务</p>
      <p class="text-xs mt-4 text-white/20 flex items-center gap-1.5">
        <SvgIcon icon="ri:arrow-left-line" class="text-sm text-violet-400/50" />
        在左侧批量面板提交任务
      </p>
    </div>

    <!-- Job Cards Grid with Transitions -->
    <TransitionGroup
      v-else
      name="job-list"
      tag="div"
      class="job-grid"
    >
      <div
        v-for="(job, index) in filteredJobs"
        :key="job.id"
        class="job-card"
        :class="[`job-card--${job.status}`]"
        :style="{ animationDelay: `${index * 60}ms` }"
      >
        <!-- Card Header: Status Badge + Mode -->
        <div class="flex items-center justify-between mb-3">
          <span class="status-badge" :class="statusClass(job.status)">
            <span
              v-if="job.status === 'processing'"
              class="processing-dot mr-1.5"
            />
            {{ statusLabel(job.status) }}
          </span>
          <span v-if="job.mode" class="text-white/30 text-xs font-mono tracking-wide">{{ job.mode }}</span>
        </div>

        <!-- Prompt -->
        <p class="text-white/85 text-base leading-relaxed line-clamp-2 mb-3" :title="job.prompt">
          {{ job.prompt }}
        </p>

        <!-- Queue Position -->
        <div
          v-if="isActive(job.status) && job.queuePosition != null"
          class="text-xs text-blue-400/80 mb-2 flex items-center gap-1.5"
        >
          <SvgIcon icon="ri:time-line" class="text-xs" />
          排队 #{{ job.queuePosition }} / {{ job.queueTotal }}
        </div>

        <!-- Progress Bar (enhanced) -->
        <div v-if="job.status === 'processing' && job.progress != null" class="mb-3">
          <div class="progress-track-enhanced">
            <div
              class="progress-fill-enhanced"
              :style="{ width: `${job.progress}%` }"
            >
              <div class="progress-shimmer" />
            </div>
            <span class="progress-text">{{ job.progress }}%</span>
          </div>
        </div>

        <!-- Video Preview -->
        <div v-if="job.status === 'completed' && job.resultUrl" class="mb-3 rounded-xl overflow-hidden video-preview-wrapper group">
          <video
            :src="job.resultUrl"
            :poster="job.thumbnailUrl ?? undefined"
            loop
            muted
            playsinline
            referrerpolicy="no-referrer"
            class="w-full aspect-video object-cover bg-black/40 cursor-pointer"
            @mouseenter="($event.target as HTMLVideoElement).play()"
            @mouseleave="($event.target as HTMLVideoElement).pause()"
          />
          <div class="play-overlay">
            <div class="play-btn-circle">
              <SvgIcon icon="ri:play-fill" class="text-white text-xl ml-0.5" />
            </div>
          </div>
          <div v-if="job.duration" class="video-duration-badge">
            {{ job.duration }}s
          </div>
        </div>

        <!-- Source Image Thumbnail (if no result yet) -->
        <div
          v-else-if="job.imageUrl && !job.resultUrl"
          class="mb-3 rounded-xl overflow-hidden"
        >
          <img
            :src="job.imageUrl"
            referrerpolicy="no-referrer"
            class="w-full aspect-video object-cover bg-black/20"
            alt="source"
          />
        </div>

        <!-- Error Message (enhanced) -->
        <div
          v-if="job.status === 'failed' && job.errorMessage"
          class="error-display mb-3"
          @click="toggleError(job.id)"
        >
          <div class="error-accent" />
          <div class="error-content">
            <div class="flex items-center gap-1.5 text-xs text-red-400 font-medium mb-1">
              <SvgIcon icon="ri:alert-line" class="text-xs" />
              错误信息
              <SvgIcon
                :icon="expandedErrors.has(job.id) ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'"
                class="text-sm ml-auto text-red-400/50"
              />
            </div>
            <p class="text-xs text-red-400/80" :class="expandedErrors.has(job.id) ? '' : 'line-clamp-2'">
              {{ job.errorMessage }}
            </p>
          </div>
        </div>

        <!-- Mini Timeline -->
        <div class="timeline-mini mb-3">
          <div class="timeline-node" :class="job.createdAt ? 'active' : ''">
            <div class="timeline-dot bg-white/30" />
            <span class="timeline-label">{{ job.createdAt ? formatTime(job.createdAt) : '--' }}</span>
          </div>
          <div class="timeline-connector" :class="job.startedAt ? 'filled' : ''" />
          <div class="timeline-node" :class="job.startedAt ? 'active' : ''">
            <div class="timeline-dot" :class="job.startedAt ? 'bg-violet-400/70' : 'bg-white/10'" />
            <span class="timeline-label">{{ job.startedAt ? formatTime(job.startedAt) : '--' }}</span>
          </div>
          <div class="timeline-connector" :class="job.finishedAt ? 'filled' : ''" />
          <div class="timeline-node" :class="job.finishedAt ? 'active' : ''">
            <div class="timeline-dot" :class="job.finishedAt ? (job.status === 'failed' ? 'bg-red-400/70' : 'bg-emerald-400/70') : 'bg-white/10'" />
            <span class="timeline-label">{{ job.finishedAt ? formatTime(job.finishedAt) : '--' }}</span>
          </div>
        </div>

        <!-- Time Info -->
        <div class="flex items-center gap-3 text-[11px] text-white/30 mb-3">
          <span v-if="isActive(job.status)" class="text-violet-400/60">
            {{ elapsedTime(job.createdAt) }}
          </span>
          <span v-if="job.resolution" class="text-white/20">{{ job.resolution }}</span>
          <span v-if="job.retryCount > 0" class="text-amber-400/50">
            重试 x{{ job.retryCount }}
          </span>
        </div>

        <!-- Action Buttons (icon + text on larger screens) -->
        <div class="flex items-center gap-2 mt-auto pt-3 border-t border-white/5">
          <!-- Cancel (active jobs) -->
          <NPopconfirm
            v-if="isActive(job.status)"
            @positive-click="handleCancel(job.id)"
          >
            <template #trigger>
              <button class="action-btn text-amber-400/60 hover:text-amber-400 hover:bg-amber-400/10" title="取消">
                <SvgIcon icon="ri:close-circle-line" class="text-sm" />
                <span class="action-btn-label">取消</span>
              </button>
            
  <NModal v-model:show="showDownloadPicker" preset="card" :title="'下载视频'" style="width: 340px; background: rgba(15,15,25,0.98); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px;" :segmented="{ content: true }">
    <div v-if="downloadJob" class="space-y-3 py-1">
      <button
        v-if="hasServerDownload"
        class="flex w-full items-center gap-3 rounded-xl border border-sky-400/15 bg-sky-500/[0.06] px-4 py-3 text-left transition-all hover:border-sky-400/30 hover:bg-sky-500/12 active:scale-[0.98]"
        @click="doDownload(serverDownloadUrl, `video-${downloadJob.id.slice(0,8)}.mp4`, true, directUrl)"
      >
        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15">
          <SvgIcon icon="ri:server-line" class="text-base text-sky-400" />
        </div>
        <div>
          <p class="text-[13px] font-medium text-white/80">{{ serverDownloadTitle }}</p>
          <p class="text-[11px] text-white/30">{{ serverDownloadHint }}</p>
        </div>
      </button>
      <button
        v-if="directUrl"
        class="flex w-full items-center gap-3 rounded-xl border border-emerald-400/15 bg-emerald-500/[0.06] px-4 py-3 text-left transition-all hover:border-emerald-400/30 hover:bg-emerald-500/12 active:scale-[0.98]"
        @click="openDirectDownload(directUrl, `video-${downloadJob.id.slice(0,8)}-hd.mp4`)"
      >
        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15">
          <SvgIcon icon="ri:cloud-line" class="text-base text-emerald-400" />
        </div>
        <div>
          <p class="text-[13px] font-medium text-white/80">直连下载</p>
          <p class="text-[11px] text-white/30">从源站直接下载,可能较慢</p>
        </div>
      </button>
      <p v-if="!directUrl && hasServerDownload" class="text-center text-[10px] text-white/20">当前任务只有服务器下载地址</p>
      <p v-if="!directUrl && !hasServerDownload" class="text-center text-[10px] text-white/20">暂无下载地址</p>
    </div>
  </NModal>
</template>
            确定取消此任务?
          </NPopconfirm>

          <!-- Retry (failed jobs) -->
          <button
            v-if="job.status === 'failed'"
            class="action-btn text-blue-400/60 hover:text-blue-400 hover:bg-blue-400/10"
            title="重试"
            @click="handleRetry(job.id)"
          >
            <SvgIcon icon="ri:refresh-line" class="text-sm" />
            <span class="action-btn-label">重试</span>
          </button>

          <!-- Download (completed jobs) -->
          <button
            v-if="job.status === 'completed' && job.resultUrl"
            class="action-btn text-emerald-400/60 hover:text-emerald-400 hover:bg-emerald-400/10"
            title="下载"
            @click="openDownloadPicker(job)"
          >
            <SvgIcon icon="ri:download-line" class="text-sm" />
            <span class="action-btn-label">下载</span>
          </button>

          <!-- Delete (any job) -->
          <NPopconfirm @positive-click="handleDelete(job.id)">
            <template #trigger>
              <button class="action-btn ml-auto text-red-400/40 hover:text-red-400 hover:bg-red-400/10" title="删除">
                <SvgIcon icon="ri:delete-bin-line" class="text-sm" />
                <span class="action-btn-label">删除</span>
              </button>
            </template>
            确定删除此任务? 此操作不可撤销。
          </NPopconfirm>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive, nextTick, watch } from 'vue'
import { NPopconfirm, NSpin, NModal, useMessage } from 'naive-ui'
import { SvgIcon } from '@/components/common'
import { fetchJobs, cancelJob, retryJob, deleteJob } from '@/api/runwayJobs'
import { useRunwayJwt } from '@/composables/useRunwayJwt'

interface RunwayJob {
  id: string
  status: string
  prompt: string
  mode: string
  progress: number | null
  resultUrl: string | null
  thumbnailUrl: string | null
  queuePosition: number | null
  queueTotal: number
  imageUrl: string | null
  duration: number
  resolution: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  errorMessage: string | null
  retryCount: number
  videoUrl?: string | null
}

type TabKey = 'all' | 'queued' | 'processing' | 'completed' | 'failed'

const POLL_INTERVAL = 3000
const ACTIVE_STATUSES = ['pending', 'queued', 'submitted', 'processing']
const QUEUED_STATUSES = ['pending', 'queued', 'submitted']

const message = useMessage()
const { headers: authHeaders } = useRunwayJwt()
const jobs = ref<RunwayJob[]>([])
const loading = ref(false)
const activeTab = ref<TabKey>('all')
const lastUpdated = ref<Date | null>(null)
const now = ref(Date.now())
const expandedErrors = reactive(new Set<string>())

// Segmented control refs
const tabRefs = ref<(HTMLElement | null)[]>([])
const indicatorStyle = ref<Record<string, string>>({})

function setTabRef(el: any, idx: number) {
  if (el) tabRefs.value[idx] = el as HTMLElement
}

function updateIndicator() {
  const tabIdx = tabs.value.findIndex(t => t.key === activeTab.value)
  const el = tabRefs.value[tabIdx]
  if (el) {
    indicatorStyle.value = {
      width: `${el.offsetWidth}px`,
      transform: `translateX(${el.offsetLeft}px)`,
    }
  }
}

watch(activeTab, () => nextTick(updateIndicator))
onMounted(() => nextTick(() => setTimeout(updateIndicator, 50)))

function toggleError(id: string) {
  if (expandedErrors.has(id)) expandedErrors.delete(id)
  else expandedErrors.add(id)
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null

// Counts
const activeCount = computed(() =>
  jobs.value.filter(j => ACTIVE_STATUSES.includes(j.status)).length,
)
const completedCount = computed(() =>
  jobs.value.filter(j => j.status === 'completed').length,
)
const failedCount = computed(() =>
  jobs.value.filter(j => j.status === 'failed').length,
)
const queuedCount = computed(() =>
  jobs.value.filter(j => QUEUED_STATUSES.includes(j.status)).length,
)
const processingCount = computed(() =>
  jobs.value.filter(j => j.status === 'processing').length,
)

// Tabs
const tabs = computed(() => [
  { key: 'all' as TabKey, label: '全部', count: jobs.value.length },
  { key: 'queued' as TabKey, label: '排队中', count: queuedCount.value },
  { key: 'processing' as TabKey, label: '生成中', count: processingCount.value },
  { key: 'completed' as TabKey, label: '已完成', count: completedCount.value },
  { key: 'failed' as TabKey, label: '失败', count: failedCount.value },
])

// Filtered jobs
const filteredJobs = computed(() => {
  switch (activeTab.value) {
    case 'queued':
      return jobs.value.filter(j => QUEUED_STATUSES.includes(j.status))
    case 'processing':
      return jobs.value.filter(j => j.status === 'processing')
    case 'completed':
      return jobs.value.filter(j => j.status === 'completed')
    case 'failed':
      return jobs.value.filter(j => j.status === 'failed')
    default:
      return jobs.value
  }
})

const lastUpdatedDisplay = computed(() => {
  if (!lastUpdated.value)
    return '--'
  return lastUpdated.value.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
})

// Helpers
function isActive(status: string): boolean {
  return ACTIVE_STATUSES.includes(status)
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: '等待中',
    queued: '排队中',
    submitted: '已提交',
    processing: '生成中',
    completed: '已完成',
    failed: '失败',
  }
  return map[status] ?? status
}

function statusClass(status: string): string {
  const map: Record<string, string> = {
    pending: 'badge-gray',
    queued: 'badge-blue',
    submitted: 'badge-blue',
    processing: 'badge-purple',
    completed: 'badge-green',
    failed: 'badge-red',
  }
  return map[status] ?? 'badge-gray'
}

function formatTime(iso: string): string {
  if (!iso)
    return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function elapsedTime(iso: string): string {
  if (!iso)
    return ''
  const seconds = Math.floor((now.value - new Date(iso).getTime()) / 1000)
  if (seconds < 60)
    return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (minutes < 60)
    return `${minutes}m${secs}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${minutes % 60}m`
}

// API actions
async function loadJobs() {
  try {
    loading.value = true
    jobs.value = await fetchJobs()
    lastUpdated.value = new Date()
  }
  catch (err: any) {
    console.error('[RunwayQueue] fetch failed:', err)
  }
  finally {
    loading.value = false
  }
}

async function handleCancel(id: string) {
  try {
    await cancelJob(id)
    message.success('任务已取消')
    await loadJobs()
  }
  catch {
    message.error('取消失败')
  }
}

async function handleRetry(id: string) {
  try {
    await retryJob(id)
    message.success('已重新提交')
    await loadJobs()
  }
  catch {
    message.error('重试失败')
  }
}

async function handleDelete(id: string) {
  try {
    await deleteJob(id)
    message.success('已删除')
    await loadJobs()
  }
  catch {
    message.error('删除失败')
  }
}

// Lifecycle
onMounted(() => {
  loadJobs()
  pollTimer = setInterval(loadJobs, POLL_INTERVAL)
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (clockTimer) {
    clearInterval(clockTimer)
    clockTimer = null
  }
})

// ===== Download picker (server cache vs direct) =====
const showDownloadPicker = ref(false)
const downloadJob = ref<RunwayJob | null>(null)
const openDownloadPicker = (job: RunwayJob) => {
  downloadJob.value = job
  showDownloadPicker.value = true
}
const directUrl = computed(() => {
  const job = downloadJob.value
  if (!job) return ''
  if (job.videoUrl) return job.videoUrl
  if (job.resultUrl && job.resultUrl.startsWith('http')) return job.resultUrl
  return ''
})

const hasServerCache = computed(() => {
  const url = downloadJob.value?.resultUrl || ''
  return url.startsWith('/img/')
})

const hasServerDownload = computed(() => {
  const job = downloadJob.value
  return !!(job?.resultUrl || job?.videoUrl)
})

const serverDownloadUrl = computed(() => {
  const job = downloadJob.value
  return job ? `/api/runway/jobs/${job.id}/download?source=server` : ''
})

const serverDownloadTitle = computed(() => hasServerCache.value ? '服务器缓存下载' : '服务器中转下载')
const serverDownloadHint = computed(() => hasServerCache.value ? '从服务器缓存文件下载，稳定快速' : '由服务器转发源文件，避免浏览器拦截')

const saveBlob = (blob: Blob, filename: string) => {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

const openDirectDownload = (url: string, filename: string) => {
  if (!url) return
  showDownloadPicker.value = false
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.target = '_blank'
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  message.success('已打开直连下载')
}

const doDownload = async (url: string, filename: string, withAuth = false, fallbackUrl = '') => {
  showDownloadPicker.value = false
  message.info('开始下载...')
  try {
    const res = await fetch(url, withAuth ? { headers: authHeaders() } : undefined)
    if (!res.ok) throw new Error('下载失败')
    const blob = await res.blob()
    saveBlob(blob, filename)
    message.success('下载完成')
  } catch {
    if (fallbackUrl) {
      message.warning('服务器下载失败，已尝试直连下载')
      openDirectDownload(fallbackUrl, filename)
    } else {
      message.warning('浏览器下载失败，将在新窗口打开')
      window.open(url, '_blank', 'noopener')
    }
  }
}
</script>

<style scoped>
.runway-queue-panel {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
}

/* ============================================
   STATS CHIPS
   ============================================ */
.stats-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(12px);
  transition: all 0.3s ease;
}

.stats-chip:hover {
  background: rgba(255, 255, 255, 0.07);
}

.glow-pulse {
  animation: glowPulse 2s ease-in-out infinite;
  border-color: rgba(96, 165, 250, 0.3);
}

@keyframes glowPulse {
  0%, 100% {
    box-shadow: 0 0 8px rgba(96, 165, 250, 0.15), 0 0 0 rgba(96, 165, 250, 0);
    border-color: rgba(96, 165, 250, 0.2);
  }
  50% {
    box-shadow: 0 0 16px rgba(96, 165, 250, 0.3), 0 0 32px rgba(96, 165, 250, 0.1);
    border-color: rgba(96, 165, 250, 0.45);
  }
}

.animate-spin-slow {
  animation: spin 2.5s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ============================================
   SEGMENTED CONTROL (Filter Tabs)
   ============================================ */
.segmented-control {
  display: inline-flex;
  position: relative;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 3px;
  gap: 0;
  overflow-x: auto;
}

.segmented-indicator {
  position: absolute;
  top: 3px;
  left: 0;
  height: calc(100% - 6px);
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(99, 102, 241, 0.25));
  border: 1px solid rgba(139, 92, 246, 0.35);
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.15);
  transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 0;
}

.segmented-btn {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  padding: 7px 18px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.4);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.25s ease;
  white-space: nowrap;
}

.segmented-btn:hover {
  color: rgba(255, 255, 255, 0.65);
}

.segmented-btn.active {
  color: #fff;
}

.segmented-badge {
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 9999px;
  font-size: 10px;
  line-height: 1;
  font-weight: 700;
}

/* ============================================
   SKELETON LOADING CARDS
   ============================================ */
.skeleton-card {
  padding: 20px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.skeleton-line {
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%);
  background-size: 200% 100%;
  animation: skeletonShimmer 1.5s ease-in-out infinite;
}

.skeleton-rect {
  border-radius: 12px;
  width: 100%;
  background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.03) 75%);
  background-size: 200% 100%;
  animation: skeletonShimmer 1.5s ease-in-out infinite;
}

@keyframes skeletonShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ============================================
   EMPTY STATE
   ============================================ */
.empty-icon-wrapper {
  animation: floatBounce 3s ease-in-out infinite;
}

@keyframes floatBounce {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
}

/* ============================================
   JOB GRID (Responsive)
   ============================================ */
.job-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

@media (min-width: 640px) {
  .job-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1100px) {
  .job-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (min-width: 1500px) {
  .job-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

/* ============================================
   JOB CARD
   ============================================ */
.job-card {
  display: flex;
  flex-direction: column;
  padding: 20px;
  padding-left: 24px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
  animation: cardFadeIn 0.4s ease both;
  position: relative;
  overflow: hidden;
}

/* Status-colored left gradient border */
.job-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: 4px 0 0 4px;
  transition: opacity 0.3s ease;
}

.job-card--pending::before,
.job-card--queued::before,
.job-card--submitted::before {
  background: linear-gradient(180deg, rgba(156,163,175,0.5), rgba(156,163,175,0.15));
}

.job-card--processing::before {
  background: linear-gradient(180deg, rgba(167,139,250,0.8), rgba(139,92,246,0.3));
}

.job-card--completed::before {
  background: linear-gradient(180deg, rgba(52,211,153,0.7), rgba(16,185,129,0.2));
}

.job-card--failed::before {
  background: linear-gradient(180deg, rgba(248,113,113,0.7), rgba(239,68,68,0.2));
}

.job-card:hover {
  transform: translateY(-3px) scale(1.01);
  box-shadow: 0 0 24px rgba(139, 92, 246, 0.12), 0 12px 40px rgba(0, 0, 0, 0.35);
  border-color: rgba(139, 92, 246, 0.2);
}

/* ============================================
   STATUS BADGES
   ============================================ */
.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.badge-gray {
  background: rgba(156, 163, 175, 0.12);
  color: rgba(156, 163, 175, 0.9);
}

.badge-blue {
  background: rgba(96, 165, 250, 0.12);
  color: rgba(96, 165, 250, 0.9);
}

.badge-purple {
  background: rgba(167, 139, 250, 0.15);
  color: rgba(167, 139, 250, 1);
}

.badge-green {
  background: rgba(52, 211, 153, 0.12);
  color: rgba(52, 211, 153, 0.9);
}

.badge-red {
  background: rgba(248, 113, 113, 0.12);
  color: rgba(248, 113, 113, 0.9);
}

/* Processing dot */
.processing-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(167, 139, 250, 1);
  animation: pulse 1.4s ease-in-out infinite;
}

/* ============================================
   PROGRESS BAR (Enhanced)
   ============================================ */
.progress-track-enhanced {
  position: relative;
  width: 100%;
  height: 6px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.progress-fill-enhanced {
  position: relative;
  height: 100%;
  border-radius: 9999px;
  background: linear-gradient(90deg, #8b5cf6, #818cf8, #a78bfa);
  transition: width 0.5s ease;
  overflow: hidden;
}

.progress-shimmer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.3) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.progress-text {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  font-size: 8px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.7);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  line-height: 1;
}

/* ============================================
   VIDEO PREVIEW
   ============================================ */
.video-preview-wrapper {
  position: relative;
}

.play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.25);
  opacity: 1;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.video-preview-wrapper:hover .play-overlay {
  opacity: 0;
}

.play-btn-circle {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(139, 92, 246, 0.6);
  backdrop-filter: blur(8px);
  border: 2px solid rgba(255, 255, 255, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s ease;
}

.video-duration-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  color: rgba(255, 255, 255, 0.85);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* ============================================
   ERROR DISPLAY
   ============================================ */
.error-display {
  display: flex;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.1);
  cursor: pointer;
  transition: background 0.2s ease;
}

.error-display:hover {
  background: rgba(239, 68, 68, 0.1);
}

.error-accent {
  width: 4px;
  flex-shrink: 0;
  background: linear-gradient(180deg, rgba(248, 113, 113, 0.8), rgba(239, 68, 68, 0.3));
}

.error-content {
  padding: 10px 12px;
  flex: 1;
  min-width: 0;
}

/* ============================================
   MINI TIMELINE
   ============================================ */
.timeline-mini {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 6px 0;
}

.timeline-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.timeline-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.1);
  transition: all 0.3s ease;
}

.timeline-node.active .timeline-dot {
  border-color: transparent;
}

.timeline-label {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.25);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.timeline-node.active .timeline-label {
  color: rgba(255, 255, 255, 0.45);
}

.timeline-connector {
  flex: 1;
  height: 2px;
  background: rgba(255, 255, 255, 0.06);
  margin: 0 4px;
  margin-bottom: 18px;
  border-radius: 1px;
  transition: background 0.3s ease;
}

.timeline-connector.filled {
  background: rgba(139, 92, 246, 0.3);
}

/* ============================================
   ACTION BUTTONS (icon + text responsive)
   ============================================ */
.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  height: 32px;
  min-width: 32px;
  padding: 0 8px;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
}

.action-btn-label {
  display: none;
}

@media (min-width: 1100px) {
  .action-btn {
    gap: 5px;
    padding: 0 12px;
    border-radius: 8px;
  }

  .action-btn-label {
    display: inline;
  }
}

/* ============================================
   LIST TRANSITION
   ============================================ */
.job-list-enter-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.job-list-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.job-list-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.97);
}

.job-list-leave-to {
  opacity: 0;
  transform: translateX(-20px) scale(0.97);
}

.job-list-move {
  transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ============================================
   ANIMATIONS
   ============================================ */
@keyframes cardFadeIn {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.75);
  }
}
</style>
