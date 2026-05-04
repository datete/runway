<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { NButton, NCheckbox, NDrawer, NDrawerContent, NEmpty, NModal, NPagination, NProgress, NSpin, NTag, useMessage } from 'naive-ui'
import { homeStore } from '@/store'
import { SvgIcon } from '@/components/common'
import { useRunwayJwt } from '@/composables/useRunwayJwt'
import RunwayAdminPanel from './RunwayAdminPanel.vue'
import RunwayLoginModal from './RunwayLoginModal.vue'
import JSZip from 'jszip'

interface RunwayJob {
  id: string
  prompt: string
  remark: string | null
  mode: string
  status: string
  duration: number | null
  resultUrl: string | null
  videoUrl: string | null
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
  hourlyCompleted?: number | null
  etaMinutes?: number | null
  progress: number
  priority?: number | null
  username?: string | null
}

type TabKey = 'all' | 'queued' | 'processing' | 'completed' | 'failed'

const message = useMessage()
const { headers: authHeaders, token: jwtToken, role: jwtRole, username: jwtUsername, removeToken } = useRunwayJwt()

const showLoginModal = ref(!jwtToken.value)
const showAdminPanel = ref(false)

// Device management
const showDevicePanel = ref(false)
interface DeviceInfo {
  id: string
  fingerprint: string
  deviceName: string
  browser: string
  os: string
  firstSeenAt: string
  lastSeenAt: string
  lastIp: string
  isTrusted: boolean
  isBlocked: boolean
}
const myDevices = ref<DeviceInfo[]>([])
const devicesLoading = ref(false)
const maxDevices = ref(3)

const fetchMyDevices = async () => {
  devicesLoading.value = true
  try {
    const res = await fetch('/api/runway/auth/devices', { headers: authHeaders() })
    if (res.ok) {
      myDevices.value = await res.json()
    }
    // Also get user info for maxDevices
    const meRes = await fetch('/api/runway/auth/me', { headers: authHeaders() })
    if (meRes.ok) {
      const me = await meRes.json()
      maxDevices.value = me.maxDevices ?? 3
    }
  } catch {}
  devicesLoading.value = false
}

const removeDevice = async (deviceId: string) => {
  try {
    const res = await fetch(`/api/runway/auth/devices/${deviceId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    if (res.ok) {
      myDevices.value = myDevices.value.filter(d => d.id !== deviceId)
      message.success('\u8bbe\u5907\u5df2\u89e3\u7ed1')
    } else {
      const data = await res.json()
      message.error(data.error || '\u89e3\u7ed1\u5931\u8d25')
    }
  } catch {
    message.error('\u89e3\u7ed1\u5931\u8d25')
  }
}

const formatDeviceTime = (ts: string) => {
  if (!ts) return '-'
  const d = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return '\u521a\u521a'
  if (diff < 3600000) return Math.floor(diff / 60000) + '\u5206\u949f\u524d'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '\u5c0f\u65f6\u524d'
  return Math.floor(diff / 86400000) + '\u5929\u524d'
}

const openDevicePanel = () => {
  showDevicePanel.value = true
  fetchMyDevices()
}

const allJobs = ref<RunwayJob[]>([])
const page = ref(1)
const pageSize = ref(24)
const totalJobs = ref(0)
const tabCounts = ref({ all: 0, queued: 0, processing: 0, completed: 0, failed: 0 })
const activeTab = ref<TabKey>('all')
const searchKeyword = ref('')
const activeTag = ref('')

// Tags
const allTags = ref<Array<{ tag: string; count: number }>>([])
const tagsLoading = ref(false)
const showTagDeleteConfirm = ref(false)
const tagToDelete = ref<{ tag: string; count: number } | null>(null)
const tagDeleting = ref(false)

const fetchTags = async () => {
  if (!jwtToken.value) return
  tagsLoading.value = true
  try {
    const res = await fetch('/api/runway/tags', { headers: authHeaders() })
    if (res.ok) allTags.value = await res.json()
  } catch {}
  tagsLoading.value = false
}

const filterByTag = (tag: string) => {
  activeTag.value = activeTag.value === tag ? '' : tag
  page.value = 1
}
const clearTag = () => {
  activeTag.value = ''
  page.value = 1
}

const confirmDeleteTag = (t: { tag: string; count: number }) => {
  tagToDelete.value = t
  showTagDeleteConfirm.value = true
}

const doDeleteTag = async () => {
  if (!tagToDelete.value) return
  tagDeleting.value = true
  try {
    const res = await fetch('/api/runway/tags/' + encodeURIComponent(tagToDelete.value.tag), {
      method: 'DELETE',
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error('删除失败')
    const data = await res.json()
    message.success('已删除标签「' + tagToDelete.value.tag + '」下 ' + data.deleted + ' 条任务')
    showTagDeleteConfirm.value = false
    tagToDelete.value = null
    if (searchKeyword.value) searchKeyword.value = ''
    fetchJobs()
    fetchTags()
  } catch (e: any) {
    message.error(e.message || '删除失败')
  } finally {
    tagDeleting.value = false
  }
}

const selectMode = ref(false)
const selected = ref<Set<string>>(new Set())
const showConfirm = ref(false)
const deleting = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

// Loading state
const loading = ref(false)
const mountedOnce = ref(false)
const fetchError = ref('')

// Inline video playback
const playingVideoId = ref<string | null>(null)
const toggleInlinePlay = (jobId: string, e?: Event) => {
  e?.stopPropagation()
  playingVideoId.value = playingVideoId.value === jobId ? null : jobId
}

// Task detail drawer
const showDetail = ref(false)
const detailJob = ref<RunwayJob | null>(null)
const openDetail = (job: RunwayJob) => {
  detailJob.value = job
  showDetail.value = true
}

// Get all reference images
const getAllImages = (job: RunwayJob): string[] => {
  const imgs: string[] = []
  if (job.referenceImages) {
    try {
      const parsed = JSON.parse(job.referenceImages)
      if (Array.isArray(parsed)) imgs.push(...parsed)
    } catch {}
  }
  if (job.imageUrl && !imgs.includes(job.imageUrl)) imgs.push(job.imageUrl)
  return imgs
}

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

const tabCount = computed(() => tabCounts.value)

const filteredJobs = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return allJobs.value
  return allJobs.value.filter((j) => {
    const prompt = (j.prompt || '').toLowerCase()
    const id = (j.id || '').toLowerCase()
    const remarkStr = (j.remark || '').toLowerCase()
    return prompt.includes(kw) || id.includes(kw) || remarkStr.includes(kw)
  })
})

const pageCount = computed(() => Math.max(1, Math.ceil(totalJobs.value / pageSize.value)))


const activeJobCount = computed(() => tabCounts.value.queued + tabCounts.value.processing)
const completionRate = computed(() => {
  const done = tabCounts.value.completed
  const total = tabCounts.value.completed + tabCounts.value.failed
  return total > 0 ? Math.round(done / total * 100) : 0
})

const paginatedJobs = computed(() => filteredJobs.value)

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

const formatEtaMinutes = (minutes?: number | null) => {
  if (!minutes || minutes <= 0) return ''
  if (minutes < 60) return `约 ${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `约 ${hours} 小时 ${rest} 分钟` : `约 ${hours} 小时`
}

const etaLabel = (job: RunwayJob) => {
  if (!isActive(job.status)) return ''
  const eta = formatEtaMinutes(job.etaMinutes)
  if (eta) return eta
  return job.hourlyCompleted === 0 ? '近1小时暂无完成任务' : '等待速度数据'
}

const etaHint = (job: RunwayJob) => {
  const speed = job.hourlyCompleted ?? 0
  return speed > 0 ? `按近1小时 ${speed} 个/小时估算` : '近1小时完成速度不足，暂按排队位置展示'
}

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

const fetchJobs = async (silent = false) => {
  if (!jwtToken.value) {
    showLoginModal.value = true
    return
  }
  if (!silent) loading.value = true
  fetchError.value = ''

  try {
    const statusMap: Record<string, string> = { queued: 'queued', processing: 'processing', completed: 'completed', failed: 'failed' }
    const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize.value) })
    if (activeTab.value !== 'all') params.set('status', statusMap[activeTab.value] || '')
    if (searchKeyword.value.trim()) params.set('search', searchKeyword.value.trim())
    if (activeTag.value) params.set('tag', activeTag.value)
    const res = await fetch('/api/runway/jobs?' + params.toString(), { headers: authHeaders() })
    if (!res.ok) {
      if (res.status === 401) { showLoginModal.value = true; return }
      throw new Error('任务列表加载失败')
    }

    const data = await res.json()
    const rawJobs = data.jobs || data
    // UI fix: treat THROTTLED queued (has remoteTaskId) as processing to avoid flip-flop
    for (const j of rawJobs) {
      if (j.status === "queued" && (j as any).remoteTaskId) j.status = "processing"
    }
    allJobs.value = rawJobs
    totalJobs.value = data.total ?? allJobs.value.length
    if (data.counts) tabCounts.value = data.counts

    // Update detail drawer if open
    if (showDetail.value && detailJob.value) {
      const updated = allJobs.value.find(j => j.id === detailJob.value!.id)
      if (updated) detailJob.value = updated
    }

    const hasActive = activeJobCount.value > 0
    if (hasActive && !pollTimer) pollTimer = setInterval(() => { if (document.visibilityState === "visible") fetchJobs(true) }, 8000)
    if (!hasActive) stopPolling()
  } catch (e: any) {
    if (!silent) fetchError.value = e.message || '网络异常'
  } finally {
    loading.value = false
  }
}

const switchTab = (tab: TabKey) => {
  activeTab.value = tab
  page.value = 1
  selected.value = new Set()
  playingVideoId.value = null
  fetchJobs(true)
}

// Refetch when page changes (also covers tab switch when page wasn't 1)
watch(page, () => { fetchJobs(true) })

// Debounced search: refetch from server when keyword changes
let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(searchKeyword, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => { page.value = 1; fetchJobs(true) }, 400)
})
watch(activeTag, () => { fetchJobs(true) })
watch(pageCount, (pc) => { if (page.value > pc) page.value = Math.max(1, pc) })

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

const retryingIds = ref(new Set<string>())

const retryJob = async (id: string) => {
  if (retryingIds.value.has(id)) return
  retryingIds.value.add(id)
  try {
    const res = await fetch(`/api/runway/jobs/${id}/retry`, {
      method: 'POST',
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error('重试失败')
    message.success('任务已重新排队')
    fetchJobs()
  } catch (error: any) {
    message.error(error.message || '重试失败')
  } finally {
    retryingIds.value.delete(id)
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

const showDownloadPicker = ref(false)
const downloadJob = ref<RunwayJob | null>(null)

const openDownloadPicker = (job: RunwayJob) => {
  downloadJob.value = job
  showDownloadPicker.value = true
}

// Resolve the direct (original Runway) download URL
// Priority: videoUrl if present, otherwise resultUrl if it's a remote URL
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

const prioritizeJob = async (jobId: string) => {
  try {
    const res = await fetch('/api/runway/jobs/' + jobId + '/prioritize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ priority: 10 })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '操作失败')
    await fetchJobs()
    // Show queue position after refresh
    const job = allJobs.value.find((j: any) => j.id === jobId)
    if (job?.queuePosition) {
      message.success(`⚡ 已插队！当前排队位置：第 ${job.queuePosition}/${job.queueTotal || '?'} 位`)
    } else {
      message.success('⚡ 已设为优先')
    }
  } catch (e: any) {
    message.error(e.message)
  }
}

const deprioritizeJob = async (jobId: string) => {
  try {
    const res = await fetch('/api/runway/jobs/' + jobId + '/prioritize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ priority: 0 })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '操作失败')
    await fetchJobs()
    const job = allJobs.value.find((j: any) => j.id === jobId)
    if (job?.queuePosition) {
      message.success(`已取消优先，当前排队位置：第 ${job.queuePosition}/${job.queueTotal || '?'} 位`)
    } else {
      message.success('已取消优先')
    }
  } catch (e: any) {
    message.error(e.message)
  }
}

const downloadLoading = ref(false)

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
  downloadLoading.value = true
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
  } finally {
    downloadLoading.value = false
  }
}

// Legacy single download for backward compat
const downloadVideo = (job: RunwayJob) => {
  if (!job.resultUrl) return
  openDownloadPicker(job)
}

// Change password
const showChangePwd = ref(false)
const oldPwd = ref('')
const newPwd = ref('')
const confirmPwd = ref('')
const changePwdLoading = ref(false)

const changePassword = async () => {
  if (!oldPwd.value || !newPwd.value) { message.warning('请填写完整'); return }
  if (newPwd.value.length < 6) { message.warning('新密码至少6位'); return }
  if (newPwd.value !== confirmPwd.value) { message.warning('两次密码不一致'); return }
  changePwdLoading.value = true
  try {
    const res = await fetch('/api/runway/auth/change-password', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: oldPwd.value, newPassword: newPwd.value }),
    })
    const data = await res.json()
    if (res.ok) {
      message.success('密码修改成功')
      showChangePwd.value = false
      oldPwd.value = ''; newPwd.value = ''; confirmPwd.value = ''
    } else {
      message.error(data.error || '修改失败')
    }
  } catch { message.error('网络错误') }
  changePwdLoading.value = false
}


const copyTaskId = (id: string) => {
  navigator.clipboard.writeText(id).then(() => {
    message.success("任务ID已复制")
  }).catch(() => {
    message.warning("复制失败")
  })
}

const downloadStatus = ref<{ active: boolean; phase: 'fetching' | 'zipping' | 'done'; current: number; total: number; percent: number; skipped?: number } | null>(null)

const MAX_BATCH_DOWNLOAD = 20

const downloadableJobs = computed(() => {
  return allJobs.value.filter((j) => selected.value.has(j.id) && j.status === 'completed' && (j.resultUrl || j.videoUrl))
})

const batchDownloadDisabled = computed(() => {
  if (downloadStatus.value?.active) return true
  if (downloadableJobs.value.length === 0) return true
  if (downloadableJobs.value.length > MAX_BATCH_DOWNLOAD) return true
  return false
})

const sanitizeFilename = (name: string) => name.replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim()

const handleBatchDownload = async () => {
  const targets = downloadableJobs.value
  if (targets.length === 0) {
    message.warning('选中的任务中没有可下载的已完成视频')
    return
  }
  if (targets.length > MAX_BATCH_DOWNLOAD) {
    message.warning(`可下载的视频最多 ${MAX_BATCH_DOWNLOAD} 个，当前选中 ${targets.length} 个`)
    return
  }
  const zip = new JSZip()
  let skipped = 0
  downloadStatus.value = { active: true, phase: 'fetching', current: 0, total: targets.length, percent: 0, skipped: 0 }
  for (let i = 0; i < targets.length; i++) {
    const job = targets[i]
    downloadStatus.value = { ...downloadStatus.value!, current: i + 1 }
    try {
      const blob = await fetch(`/api/runway/jobs/${job.id}/download?source=server`, { headers: authHeaders() }).then((r) => {
        if (!r.ok) throw new Error('fetch failed')
        return r.blob()
      })
      const base = sanitizeFilename(`${job.id.slice(0, 8)}_${(job.prompt || 'video').slice(0, 20)}`)
      zip.file(`${base}.mp4`, blob)
    } catch {
      skipped++
      downloadStatus.value = { ...downloadStatus.value!, skipped }
    }
  }
  downloadStatus.value = { ...downloadStatus.value!, phase: 'zipping', percent: 0 }
  const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
    if (downloadStatus.value) {
      downloadStatus.value = { ...downloadStatus.value, phase: 'zipping', percent: Math.round(meta.percent) }
    }
  })
  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `runway_batch_${Date.now()}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  downloadStatus.value = { active: false, phase: 'done', current: targets.length, total: targets.length, percent: 100, skipped }
  if (skipped > 0) message.info(`下载完成，跳过 ${skipped} 条`)
  else message.success('下载完成')
  setTimeout(() => { downloadStatus.value = null }, 3000)
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

onMounted(async () => { await fetchJobs(); fetchTags(); mountedOnce.value = true })
onUnmounted(() => stopPolling())
</script>

<template>
  <RunwayLoginModal v-model:show="showLoginModal" @loggedIn="fetchJobs" />
  <RunwayAdminPanel v-model:show="showAdminPanel" />

  <div class="runway-list-root min-h-[280px] rounded-2xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur-xl">
    <!-- Not logged in -->
    <div v-if="!jwtToken" class="flex h-64 flex-col items-center justify-center gap-4">
      <div class="empty-float">
        <SvgIcon icon="ri:lock-line" class="text-4xl text-sky-400/50" />
      </div>
      <p class="text-sm text-slate-400">请先登录后查看任务列表</p>
      <NButton type="primary" class="glass-btn-primary" @click="showLoginModal = true">去登录</NButton>
    </div>

    <template v-else>
      <!-- 1. User info bar -->
      <div class="user-info-bar mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 backdrop-blur-md">
        <div class="flex items-center gap-3 min-w-0">
          <div class="user-avatar flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-600 text-xs font-bold text-white shadow-lg shadow-sky-500/20">
            {{ (jwtUsername || '?').charAt(0).toUpperCase() }}
          </div>
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-slate-100">{{ jwtUsername }}</p>
            <p class="text-xs text-slate-400">
              {{ jwtRole === 'admin' ? '管理员账号' : '普通账号' }}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="jwtRole === 'admin'"
            class="glass-btn flex items-center gap-1.5 rounded-lg border border-sky-400/20 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 backdrop-blur transition-all hover:border-sky-400/40 hover:bg-sky-500/20 hover:shadow-lg hover:shadow-sky-500/10"
            @click="showAdminPanel = true"
          >
            <SvgIcon icon="ri:settings-3-line" class="text-sm" />
            管理后台
          </button>
          <button
            class="glass-btn rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-400 backdrop-blur transition-all hover:border-white/20 hover:bg-white/10 hover:text-slate-200"
            @click="openDevicePanel"
          >
            <SvgIcon icon="ri:device-line" class="mr-1 inline text-sm" />设备
          </button>
          <button
            class="glass-btn rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-400 backdrop-blur transition-all hover:border-white/20 hover:bg-white/10 hover:text-slate-200"
            @click="showChangePwd = true"
          >
            <SvgIcon icon="ri:lock-password-line" class="mr-1 inline text-sm" />改密
          </button>
          <button
            class="glass-btn rounded-lg border border-red-400/15 bg-red-500/8 px-3 py-1.5 text-xs text-red-300/60 backdrop-blur transition-all hover:border-red-400/25 hover:bg-red-500/15 hover:text-red-300"
            @click="handleLogout"
          >
            退出
          </button>
        </div>
      </div>

      <!-- 2. Tab filters - segmented control -->
      <div class="tab-segmented relative mb-4 flex rounded-xl border border-white/8 bg-white/4 p-1 backdrop-blur-md">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="tab-item relative z-10 flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-300"
          :class="
            activeTab === tab.key
              ? 'text-white'
              : 'text-slate-400 hover:text-slate-200'
          "
          @click="switchTab(tab.key)"
        >
          <span class="relative z-10">{{ tab.label }}</span>
          <span v-if="tabCount[tab.key] > 0" class="relative z-10 ml-1 opacity-70">{{ tabCount[tab.key] }}</span>
          <!-- Active indicator -->
          <div
            v-if="activeTab === tab.key"
            class="tab-active-bg absolute inset-0 rounded-lg bg-gradient-to-r from-sky-600 to-blue-600 shadow-lg shadow-sky-500/20"
          />
        </button>
      </div>

      <!-- Search box -->
      <div class="mb-3">
        <div class="flex items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-3 py-2 backdrop-blur-md focus-within:border-sky-400/40">
          <svg class="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input
            v-model="searchKeyword"
            type="text"
            placeholder="搜索提示词、备注标签或任务ID..."
            class="flex-1 border-none bg-transparent text-xs text-white placeholder-slate-500 outline-none"
          />
          <button
            v-if="searchKeyword"
            class="text-xs text-slate-400 hover:text-white"
            @click="searchKeyword = ''"
          >清除</button>
        </div>
      </div>


        <!-- Quick stats -->
        <div class="mt-2.5 flex items-center gap-2 text-[10px]">
          <span class="rounded-md border border-white/6 bg-white/[0.03] px-2 py-0.5 text-white/30">
            共 <span class="font-semibold text-white/50">{{ tabCount.all }}</span> 任务
          </span>
          <span v-if="activeJobCount > 0" class="rounded-md border border-sky-400/15 bg-sky-500/[0.06] px-2 py-0.5 text-sky-300/60">
            <span class="processing-dot-sm mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-400" />{{ activeJobCount }} 进行中
          </span>
          <span v-if="completionRate > 0" class="rounded-md border border-emerald-400/12 bg-emerald-500/[0.05] px-2 py-0.5 text-emerald-300/50">
            成功率 {{ completionRate }}%
          </span>
        </div>

        <!-- Tags row -->
        <div v-if="allTags.length > 0" class="mt-2 flex flex-wrap items-center gap-1.5">
          <span class="text-[10px] text-white/20 mr-0.5">标签:</span>
          <span
            class="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] transition-all duration-200 cursor-pointer"
            :class="!activeTag
              ? 'border-violet-500/50 bg-violet-500/20 text-violet-300'
              : 'border-white/10 bg-white/5 text-white/40 hover:border-white/20 hover:text-white/60'"
            @click="clearTag"
          >全部</span>
          <div
            v-for="t in allTags"
            :key="t.tag"
            class="group/tag inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] transition-all duration-200 cursor-pointer"
            :class="activeTag === t.tag
              ? 'border-violet-400/40 bg-violet-500/15 text-violet-300'
              : 'border-white/8 bg-white/[0.03] text-white/40 hover:border-violet-400/25 hover:bg-violet-500/[0.06] hover:text-violet-300/70'"
            @click="filterByTag(t.tag)"
          >
            <span class="max-w-[80px] truncate"># {{ t.tag }}</span>
            <span class="text-[9px] opacity-50">{{ t.count }}</span>
            <button
              class="ml-0.5 hidden h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] text-red-400/0 transition-all group-hover/tag:inline-flex group-hover/tag:text-red-400/60 hover:!bg-red-500/20 hover:!text-red-300"
              title="删除此标签及其所有任务"
              @click.stop="confirmDeleteTag(t)"
            >
              ×
            </button>
          </div>
        </div>

      <!-- Bulk action bar -->
      <div class="mb-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <p class="text-xs text-slate-500">共 {{ filteredJobs.length }} 条</p>
          <button
            v-if="!selectMode"
            class="glass-btn rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-400 backdrop-blur transition-all hover:border-sky-400/30 hover:bg-sky-500/10 hover:text-sky-300"
            @click="selectMode = true"
          >
            <SvgIcon icon="ri:checkbox-multiple-line" class="mr-1 inline text-xs" />选择
          </button>
        </div>
        <div v-if="selectMode" class="flex items-center gap-1.5">
          <button
            class="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300 transition-all hover:bg-white/10"
            @click="toggleSelectAll"
          >
            {{ allPageSelected ? '取消全选' : '全选' }}
          </button>
          <button
            v-if="selected.size > 0"
            :disabled="batchDownloadDisabled"
            class="rounded-md border border-sky-400/25 bg-sky-500/10 px-2 py-1 text-[11px] font-medium text-sky-300 transition-all hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            @click="handleBatchDownload"
          >
            下载 {{ downloadableJobs.length > 0 ? downloadableJobs.length : '' }}{{ downloadableJobs.length > 0 && downloadableJobs.length !== selected.size ? '/' + selected.size : '' }}
          </button>
          <button
            v-if="selected.size > 0"
            class="rounded-md border border-red-400/20 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-300 transition-all hover:bg-red-500/20"
            @click="confirmBulkDelete"
          >
            删除 {{ selected.size }}
          </button>
          <div v-if="downloadStatus?.active" class="rounded-md border border-sky-400/20 bg-sky-500/10 px-2 py-1 text-[11px] text-sky-200">
            <template v-if="downloadStatus.phase === 'fetching'">下载 {{ downloadStatus.current }}/{{ downloadStatus.total }}</template>
            <template v-else-if="downloadStatus.phase === 'zipping'">压缩 {{ downloadStatus.percent }}%</template>
          </div>
          <button
            class="rounded-md border border-white/8 px-2 py-1 text-[11px] text-slate-500 transition-all hover:text-slate-300"
            @click="cancelSelectMode"
          >
            取消
          </button>
        </div>
      </div>

      <!-- Loading state -->
      <div v-if="loading && allJobs.length === 0" class="my-16 flex flex-col items-center justify-center gap-3">
        <NSpin size="large" />
        <p class="text-sm text-slate-500">加载任务列表...</p>
      </div>

      <!-- Error state -->
      <div v-else-if="fetchError" class="my-16 flex flex-col items-center justify-center gap-3">
        <SvgIcon icon="ri:wifi-off-line" class="text-4xl text-red-400/50" />
        <p class="text-sm text-red-300/70">{{ fetchError }}</p>
        <button class="glass-btn rounded-lg border border-sky-400/20 bg-sky-500/10 px-4 py-2 text-xs font-medium text-sky-300 transition-all hover:bg-sky-500/20" @click="fetchJobs()">
          重新加载
        </button>
      </div>

      <!-- 8. Empty state -->
      <div v-else-if="filteredJobs.length === 0" class="my-16 flex flex-col items-center justify-center gap-3">
        <div class="empty-float">
          <SvgIcon icon="ri:film-line" class="text-5xl text-sky-400/35" />
        </div>
        <p class="text-sm text-slate-500">暂无任务数据</p>
      </div>

      <!-- 3. Job cards grid -->
      <div v-else>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="(job, index) in paginatedJobs"
            :key="job.id"
            v-memo="[job.status, job.progress, job.resultUrl, job.thumbnailUrl, selected.has(job.id), playingVideoId === job.id, selectMode]"
            class="job-card group relative overflow-hidden rounded-2xl border bg-white/4 backdrop-blur-md transition-colors duration-200"
            :class="selected.has(job.id) ? 'border-sky-400/50 shadow-lg shadow-sky-500/15' : 'border-white/8 hover:border-white/15'"
            :style="mountedOnce ? {} : { animationDelay: `${Math.min(index, 6) * 40}ms` }"
            @click="selectMode ? toggleSelect(job.id) : undefined"
          >
            <!-- Select mode overlay checkbox -->
            <div
              v-if="selectMode"
              class="absolute left-3 top-3 z-20 flex h-5 w-5 cursor-pointer items-center justify-center rounded-md border transition-all duration-200"
              :class="selected.has(job.id)
                ? 'border-sky-400 bg-sky-500 shadow-md shadow-sky-500/30'
                : 'border-white/25 bg-black/40 backdrop-blur-sm hover:border-sky-400/50'"
              @click.stop="toggleSelect(job.id)"
            >
              <SvgIcon v-if="selected.has(job.id)" icon="ri:check-line" class="text-xs text-white" />
            </div>

            <!-- Status left border strip -->
            <div
              class="absolute left-0 top-0 bottom-0 w-1"
              :class="{
                'bg-gradient-to-b from-sky-400 to-blue-500': isProcessing(job.status),
                'bg-gradient-to-b from-teal-400 to-emerald-500': job.status === 'completed',
                'bg-gradient-to-b from-rose-400 to-red-500': job.status === 'failed',
                'bg-gradient-to-b from-zinc-400 to-zinc-500': isQueued(job.status),
                'bg-gradient-to-b from-amber-400 to-orange-500': job.status === 'cancelled',
              }"
            />



            <!-- 4. Video preview - inline playback -->
            <div v-if="job.resultUrl" class="video-thumb relative bg-black" @click="toggleInlinePlay(job.id, $event)">
              <!-- Playing state: show video with controls -->
              <video
                v-if="playingVideoId === job.id"
                controls
                autoplay
                loop
                class="aspect-video w-full object-contain"
                :src="job.resultUrl"
                @click.stop
              />
              <!-- Thumbnail state: static preview with play button -->
              <template v-else>
                <img v-if="job.thumbnailUrl" :src="job.thumbnailUrl" loading="lazy" class="aspect-video w-full object-cover pointer-events-none" />
                <div v-else class="aspect-video w-full bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center">
                  <SvgIcon icon="ri:movie-2-line" class="text-2xl text-white/20" />
                </div>
                <div class="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/20 transition-all duration-200 hover:bg-black/10">
                  <div class="play-breathe flex h-11 w-11 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm transition-transform">
                    <SvgIcon icon="ri:play-fill" class="ml-0.5 text-xl text-white/90" />
                  </div>
                </div>
              </template>

              <!-- Duration + model badges -->
              <div v-if="playingVideoId !== job.id" class="absolute bottom-2 right-2 flex items-center gap-1">
                <span v-if="job.modelName === 'seedance_2'" class="rounded-md bg-emerald-500/70 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm">SD2</span>
                <span v-else class="rounded-md bg-sky-500/70 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm">可灵</span>
                <span v-if="job.duration" class="rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/70 backdrop-blur-sm">{{ job.duration }}s</span>
              </div>
            </div>

            <!-- 5. Processing state with shimmer -->
            <div
              v-else-if="isActive(job.status)"
              class="relative aspect-video w-full overflow-hidden bg-slate-900/80"
            >
              <div v-if="getAllImages(job).length > 1" class="absolute inset-0 grid grid-cols-2 gap-0.5">
                <img v-for="(img, i) in getAllImages(job).slice(0, 2)" :key="i" :src="img" class="h-full w-full object-cover opacity-50" />
              </div>
              <img v-else-if="getFirstImage(job)" :src="getFirstImage(job) as string" class="h-full w-full object-cover opacity-50" />
              <div class="shimmer-overlay absolute inset-0" />
              <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 py-3">
                <div class="flex items-center gap-2">
                  <div class="processing-dot h-2 w-2 rounded-full bg-sky-400" />
                  <span class="text-sm font-medium text-white">{{ statusLabel[job.status] || job.status }}</span>
                  <span v-if="isQueued(job.status) && queuePosition(job) !== null" class="text-xs text-sky-300">第 {{ queuePosition(job) }}/{{ job.queueTotal || '?' }} 位</span>
                  <span v-if="isProcessing(job.status)" class="text-xs text-sky-300">{{ job.progress != null && job.progress > 0 ? Math.round(job.progress * 100) + '%' : '处理中...' }}</span>
                </div>
                <div v-if="isProcessing(job.status)" class="progress-glow mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div class="h-full rounded-full bg-gradient-to-r from-sky-500 to-blue-400 transition-all duration-500" :style="{ width: Math.round((job.progress || 0) * 100) + '%' }" />
                </div>
              </div>
            </div>

            <!-- 5b. Static preview for non-active jobs (failed/cancelled/no video) -->
            <div v-else-if="getFirstImage(job)" class="relative aspect-video w-full overflow-hidden bg-slate-900/60">
              <div v-if="getAllImages(job).length > 1" class="absolute inset-0 grid grid-cols-2 gap-0.5">
                <img v-for="(img, i) in getAllImages(job).slice(0, 2)" :key="i" :src="img" class="h-full w-full object-cover opacity-60 transition-opacity group-hover:opacity-75" />
              </div>
              <img v-else :src="getFirstImage(job) as string" class="h-full w-full object-cover opacity-60 transition-opacity group-hover:opacity-75" />
              <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 flex items-center justify-between">
                <span
                  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                  :class="{
                    'bg-red-500/20 text-red-300': job.status === 'failed',
                    'bg-amber-500/20 text-amber-300': job.status === 'cancelled',
                    'bg-slate-500/20 text-slate-300': !['failed','cancelled'].includes(job.status),
                  }"
                >
                  <span v-if="(job as any).priority > 0 && isQueued(job.status)">⚡</span>
                  {{ (job as any).priority > 0 && isQueued(job.status) ? '优先排队' : (statusLabel[job.status] || job.status) }}
                </span>
                <span
                  class="rounded-md px-1.5 py-0.5 text-[9px] font-medium backdrop-blur-sm"
                  :class="job.modelName === 'seedance_2' ? 'bg-emerald-500/70 text-white' : 'bg-sky-500/70 text-white'"
                >{{ job.modelName === 'seedance_2' ? 'SD2' : '可灵' }}</span>
              </div>
            </div>

            <!-- Card body -->
            <div class="card-body relative p-4 pl-5 cursor-pointer" @click.stop="selectMode ? toggleSelect(job.id) : openDetail(job)">
              <!-- Click hint -->
              <div class="absolute right-2 top-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <SvgIcon icon="ri:arrow-right-up-line" class="text-sm text-white/20" />
              </div>
              <p v-if="job.remark" class="mb-1.5 text-xs font-medium text-sky-400/80"># {{ job.remark }}</p>

              <div class="mb-2.5 flex items-start justify-between gap-2">
                <p class="flex-1 break-words text-sm leading-relaxed text-slate-200 line-clamp-3">
                  <span v-if="job.seq" class="mr-1.5 inline-flex items-center rounded-md bg-white/8 px-1.5 py-0 text-[11px] font-mono font-semibold text-white/40">#{{ job.seq }}</span>{{ job.prompt }}
                </p>
                <!-- 6. Status badge pill -->
                <span
                  class="status-badge inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  :class="{
                    'bg-sky-500/15 text-sky-300 border border-sky-400/20': isProcessing(job.status),
                    'bg-emerald-500/15 text-emerald-300 border border-emerald-400/20': job.status === 'completed',
                    'bg-red-500/15 text-red-300 border border-red-400/20': job.status === 'failed',
                    'bg-slate-500/15 text-slate-300 border border-slate-400/20': isQueued(job.status),
                    'bg-amber-500/15 text-amber-300 border border-amber-400/20': job.status === 'cancelled',
                  }"
                >
                  <span v-if="isProcessing(job.status)" class="processing-dot-sm h-1.5 w-1.5 rounded-full bg-sky-400" />
                  {{ statusLabel[job.status] || job.status }}
                </span>
              </div>

              <!-- Meta info -->
              <div class="mb-2.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <span v-if="job.username" class="rounded-md border border-sky-400/15 bg-sky-500/10 px-1.5 py-0.5 font-medium text-sky-300">{{ job.username }}</span>
                <span>{{ formatTime(job.createdAt) }}</span>
                <span class="rounded-md border border-white/8 bg-white/5 px-1.5 py-0.5 text-slate-400">
                  {{ modeLabel[job.mode] || job.mode }}
                </span>
                <span v-if="job.duration" class="rounded-md border border-white/8 bg-white/5 px-1.5 py-0.5 text-slate-400">
                  {{ job.duration }} 秒
                </span>
                <span
                  class="rounded-md border px-1.5 py-0.5 font-medium"
                  :class="job.modelName === 'seedance_2'
                    ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300'
                    : 'border-sky-400/12 bg-sky-500/8 text-sky-300/70'"
                >
                  {{ job.modelName === 'seedance_2' ? 'Seedance' : '可灵' }}
                </span>
                <span v-if="formatElapsed(job)" class="text-slate-500">耗时 {{ formatElapsed(job) }}</span>
              </div>

              <div
                v-if="isActive(job.status)"
                class="mb-2.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-cyan-400/12 bg-cyan-500/[0.06] px-2.5 py-1.5 text-[11px] text-cyan-200/80"
              >
                <SvgIcon icon="ri:timer-flash-line" class="text-sm text-cyan-300/80" />
                <span class="font-medium">预计 {{ etaLabel(job) }}</span>
                <span v-if="queuePosition(job) !== null" class="text-cyan-100/45">第 {{ queuePosition(job) }}/{{ job.queueTotal || '?' }} 位</span>
                <span class="text-cyan-100/35">{{ etaHint(job) }}</span>
              </div>

              <!-- Error message -->
              <div
                v-if="job.errorMessage"
                class="mb-2.5 rounded-lg border border-red-400/15 bg-red-500/10 px-3 py-2 text-xs text-red-300"
              >
                {{ (job.errorMessage || '').replace(/request to https?:\/\/[^ ]+/g, '上传请求失败').replace('The user aborted a request.', '网络超时(将自动重试)').replace(/S3 PUT \d+/, '上传失败(将重试)').replace(/createTask \d+:.*/, '任务创建失败').slice(0, 80) }}
              </div>

              <!-- 7. Action buttons -->
              <div class="flex flex-wrap justify-end gap-1.5">
                <button
                  v-if="job.resultUrl"
                  class="action-btn rounded-lg border border-sky-400/20 bg-sky-500/10 px-2.5 py-1 text-xs text-sky-300 transition-all hover:border-sky-400/40 hover:bg-sky-500/20 hover:shadow-md hover:shadow-sky-500/10"
                  @click.stop="downloadVideo(job)"
                >
                  <SvgIcon icon="ri:download-2-line" class="mr-1 inline text-sm" />下载视频
                </button>
                <button
                  v-if="isQueued(job.status) && jwtRole === 'admin' && !(job as any).priority"
                  class="action-btn rounded-lg border border-orange-400/20 bg-orange-500/8 px-2.5 py-1 text-xs text-orange-300 transition-all hover:border-orange-400/40 hover:bg-orange-500/15"
                  @click.stop="prioritizeJob(job.id)"
                >
                  <SvgIcon icon="ri:flashlight-line" class="mr-1 inline text-sm" />优先
                </button>
                <button
                  v-if="isQueued(job.status) && jwtRole === 'admin' && (job as any).priority > 0"
                  class="action-btn rounded-lg border border-gray-400/20 bg-gray-500/8 px-2.5 py-1 text-xs text-gray-400/80 transition-all hover:border-gray-400/30 hover:bg-gray-500/15"
                  @click.stop="deprioritizeJob(job.id)"
                >
                  取消优先
                </button>
                <button
                  v-if="job.status === 'failed' || job.status === 'cancelled'"
                  class="action-btn rounded-lg border border-indigo-400/20 bg-indigo-500/10 px-2.5 py-1 text-xs text-indigo-300 transition-all hover:border-indigo-400/40 hover:bg-indigo-500/20 disabled:opacity-40 disabled:pointer-events-none"
                  :disabled="retryingIds.has(job.id)"
                  @click.stop="retryJob(job.id)"
                >
                  <SvgIcon :icon="retryingIds.has(job.id) ? 'ri:loader-4-line' : 'ri:refresh-line'" :class="['mr-1 inline text-sm', retryingIds.has(job.id) && 'animate-spin']" />{{ retryingIds.has(job.id) ? '排队中...' : '重新排队' }}
                </button>
                <button
                  v-if="!selectMode && isActive(job.status)"
                  class="action-btn rounded-lg border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 transition-all hover:border-amber-400/40 hover:bg-amber-500/20"
                  @click.stop="cancelJob(job.id)"
                >
                  取消任务
                </button>
                <button
                  v-if="!selectMode && !isActive(job.status)"
                  class="action-btn rounded-lg border border-red-400/15 bg-red-500/8 px-2.5 py-1 text-xs text-red-400/80 transition-all hover:border-red-400/30 hover:bg-red-500/15 hover:text-red-300"
                  @click.stop="deleteSingle(job.id)"
                >
                  删除任务
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 9. Pagination -->
        <div v-if="pageCount > 1" class="pagination-bar mt-6 flex justify-center rounded-xl border border-white/8 bg-white/4 px-4 py-2.5 backdrop-blur-md">
          <NPagination v-model:page="page" :page-count="pageCount" size="small" />
        </div>
      </div>
    </template>
  </div>

  <!-- Task detail drawer -->
  <NDrawer v-model:show="showDetail" placement="right" :width="420" :mask-style="{ backdropFilter: 'blur(6px)', background: 'rgba(0,0,0,0.5)' }">
    <NDrawerContent v-if="detailJob" closable class="detail-drawer">
      <template #header>
        <div class="flex items-center gap-2">
          <span
            class="inline-flex h-2.5 w-2.5 rounded-full"
            :class="{
              'bg-sky-400 animate-pulse': isProcessing(detailJob.status),
              'bg-emerald-400': detailJob.status === 'completed',
              'bg-red-400': detailJob.status === 'failed',
              'bg-slate-400': isQueued(detailJob.status),
              'bg-amber-400': detailJob.status === 'cancelled',
            }"
          />
          <span class="text-sm font-semibold text-white/90">任务详情</span>
        </div>
      </template>

      <div class="space-y-4">
        <!-- Video preview -->
        <div v-if="detailJob.resultUrl" class="overflow-hidden rounded-xl border border-white/8">
          <video controls loop preload="metadata" class="w-full" :src="detailJob.resultUrl" />
        </div>

        <!-- Processing state -->
        <div v-else-if="isActive(detailJob.status)" class="relative overflow-hidden rounded-xl border border-white/8 bg-slate-900/80 p-6 text-center">
          <img v-if="getFirstImage(detailJob)" :src="getFirstImage(detailJob) as string" class="absolute inset-0 h-full w-full object-cover opacity-20" />
          <div class="relative z-10">
            <div class="processing-dot mx-auto mb-2 h-3 w-3 rounded-full bg-sky-400" />
            <p class="text-sm font-medium text-white/80">{{ statusLabel[detailJob.status] || detailJob.status }}</p>
            <p v-if="detailJob.progress != null && detailJob.progress > 0" class="mt-1 text-lg font-bold text-sky-400">{{ Math.round(detailJob.progress * 100) }}%</p>
            <div v-if="isProcessing(detailJob.status)" class="mx-auto mt-3 h-1.5 w-48 overflow-hidden rounded-full bg-white/10">
              <div class="h-full rounded-full bg-gradient-to-r from-sky-500 to-blue-400 transition-all duration-500" :style="{ width: Math.round((detailJob.progress || 0) * 100) + '%' }" />
            </div>
          </div>
        </div>

        <!-- Reference images (all) -->
        <div v-if="getAllImages(detailJob).length > 0" class="overflow-hidden rounded-xl border border-white/8">
          <p class="border-b border-white/6 px-3 py-2 text-xs font-medium text-white/40">
            参考图片 <span class="text-white/20">({{ getAllImages(detailJob).length }})</span>
          </p>
          <div class="grid gap-1 p-1" :class="getAllImages(detailJob).length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
            <img
              v-for="(imgUrl, imgIdx) in getAllImages(detailJob)"
              :key="imgIdx"
              :src="imgUrl"
              class="w-full rounded-lg object-cover transition-opacity hover:opacity-80 cursor-pointer"
              :style="{ maxHeight: getAllImages(detailJob).length > 1 ? '140px' : '220px' }"
              @click="() => { const w = globalThis.window; w.open(imgUrl, '_blank') }"
            />
          </div>
        </div>

        <!-- Info fields -->
        <div class="space-y-2.5 rounded-xl border border-white/8 bg-white/3 p-4">
          <div class="detail-row">
            <span class="detail-label">任务ID</span>
            <span class="detail-value font-mono text-[11px] cursor-pointer hover:text-sky-400 transition-colors" title="点击复制" @click="copyTaskId(detailJob.id)">{{ detailJob.id }} <SvgIcon icon="ri:file-copy-line" class="ml-1 inline text-[10px] opacity-40" /></span>
          </div>
          <div class="detail-row">
            <span class="detail-label">状态</span>
            <span
              class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
              :class="{
                'bg-sky-500/15 text-sky-300': isProcessing(detailJob.status),
                'bg-emerald-500/15 text-emerald-300': detailJob.status === 'completed',
                'bg-red-500/15 text-red-300': detailJob.status === 'failed',
                'bg-slate-500/15 text-slate-300': isQueued(detailJob.status),
                'bg-amber-500/15 text-amber-300': detailJob.status === 'cancelled',
              }"
            >
              {{ statusLabel[detailJob.status] || detailJob.status }}
            </span>
          </div>
          <div v-if="detailJob.remark" class="detail-row">
            <span class="detail-label">备注</span>
            <span class="detail-value text-sky-400">{{ detailJob.remark }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">提示词</span>
            <span class="detail-value">{{ detailJob.prompt }}</span>
          </div>
          <div v-if="detailJob.mode" class="detail-row">
            <span class="detail-label">模式</span>
            <span class="detail-value">{{ modeLabel[detailJob.mode] || detailJob.mode }}</span>
          </div>
          <div v-if="detailJob.duration" class="detail-row">
            <span class="detail-label">时长</span>
            <span class="detail-value">{{ detailJob.duration }} 秒</span>
          </div>
          <div v-if="detailJob.modelName" class="detail-row">
            <span class="detail-label">模型</span>
            <span class="detail-value text-[11px]" :class="detailJob.modelName === 'seedance_2' ? 'text-emerald-400' : 'text-sky-400'">
              {{ detailJob.modelName === 'seedance_2' ? 'Seedance 2.0' : detailJob.modelName === 'kling_3_0_pro' ? '可灵 3.0 Pro' : detailJob.modelName }}
            </span>
          </div>
          <div v-if="detailJob.username" class="detail-row">
            <span class="detail-label">用户</span>
            <span class="detail-value text-sky-300">{{ detailJob.username }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">创建时间</span>
            <span class="detail-value">{{ formatTime(detailJob.createdAt) }}</span>
          </div>
          <div v-if="detailJob.startedAt" class="detail-row">
            <span class="detail-label">开始时间</span>
            <span class="detail-value">{{ formatTime(detailJob.startedAt) }}</span>
          </div>
          <div v-if="detailJob.finishedAt" class="detail-row">
            <span class="detail-label">完成时间</span>
            <span class="detail-value">{{ formatTime(detailJob.finishedAt) }}</span>
          </div>
          <div v-if="formatElapsed(detailJob)" class="detail-row">
            <span class="detail-label">耗时</span>
            <span class="detail-value text-emerald-400">{{ formatElapsed(detailJob) }}</span>
          </div>
          <div v-if="isQueued(detailJob.status) && queuePosition(detailJob)" class="detail-row">
            <span class="detail-label">排队位置</span>
            <span class="detail-value">第 {{ queuePosition(detailJob) }} / {{ detailJob.queueTotal || '?' }} 位</span>
          </div>
        </div>

        <!-- Error -->
        <div v-if="detailJob.errorMessage" class="rounded-xl border border-red-400/15 bg-red-500/10 p-3 text-xs text-red-300">
          <p class="mb-1 text-[11px] font-medium text-red-400">错误信息</p>
          {{ detailJob.errorMessage }}
        </div>

        <!-- Actions -->
        <div class="flex flex-wrap gap-2">
          <button v-if="detailJob.resultUrl" class="action-btn flex-1 rounded-lg border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-300 transition-all hover:bg-sky-500/20" @click="openDownloadPicker(detailJob)">
            <SvgIcon icon="ri:download-2-line" class="mr-1 inline text-sm" /> 下载视频
          </button>
          <button v-if="detailJob.status === 'failed' || detailJob.status === 'cancelled'" class="action-btn flex-1 rounded-lg border border-indigo-400/20 bg-indigo-500/10 px-3 py-2 text-xs font-medium text-indigo-300 transition-all hover:bg-indigo-500/20" @click="retryJob(detailJob.id); showDetail = false" :disabled="retryingIds.has(detailJob.id)">
            <SvgIcon icon="ri:refresh-line" class="mr-1 inline text-sm" /> 重新排队
          </button>
          <button v-if="isActive(detailJob.status)" class="action-btn flex-1 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300 transition-all hover:bg-amber-500/20" @click="cancelJob(detailJob.id); showDetail = false">
            取消任务
          </button>
          <button v-if="!isActive(detailJob.status)" class="action-btn rounded-lg border border-red-400/15 bg-red-500/8 px-3 py-2 text-xs text-red-400/80 transition-all hover:bg-red-500/15" @click="deleteSingle(detailJob.id); showDetail = false">
            删除任务
          </button>
        </div>
      </div>
    </NDrawerContent>
  </NDrawer>


  <!-- (video plays inline in cards now) -->

  <!-- 10. Delete confirmation modal -->
  <NModal v-model:show="showConfirm" :mask-style="{ backdropFilter: 'blur(8px)', background: 'rgba(0,0,0,0.6)' }">
    <div class="confirm-modal mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-xl">
      <div class="mb-4 flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/15">
          <SvgIcon icon="ri:delete-bin-6-line" class="shake-icon text-xl text-red-400" />
        </div>
        <h3 class="text-base font-semibold text-slate-100">确认删除</h3>
      </div>

      <div class="space-y-3 text-sm text-slate-300">
        <p>
          即将删除 <span class="font-semibold text-red-400">{{ selected.size }}</span> 条任务，删除后无法恢复。
        </p>
        <div class="max-h-44 space-y-1.5 overflow-y-auto rounded-xl border border-white/8 bg-white/4 p-3">
          <div v-for="job in selectedJobs" :key="job.id" class="flex items-center gap-2 text-xs">
            <span
              class="inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
              :class="{
                'bg-sky-500/15 text-sky-300': isProcessing(job.status),
                'bg-emerald-500/15 text-emerald-300': job.status === 'completed',
                'bg-red-500/15 text-red-300': job.status === 'failed',
                'bg-slate-500/15 text-slate-300': isQueued(job.status),
              }"
            >
              {{ statusLabel[job.status] || job.status }}
            </span>
            <span class="truncate text-slate-400">{{ job.remark || job.prompt }}</span>
          </div>
        </div>
      </div>

      <div class="mt-5 flex justify-end gap-2">
        <button
          class="glass-btn rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 backdrop-blur transition-all hover:bg-white/10"
          @click="showConfirm = false"
        >
          取消
        </button>
        <button
          class="rounded-lg border border-red-400/30 bg-red-500/20 px-4 py-2 text-sm font-medium text-red-300 transition-all hover:bg-red-500/30 disabled:opacity-50"
          :disabled="deleting"
          @click="doDelete([...selected])"
        >
          <NSpin v-if="deleting" size="small" class="mr-1.5" />
          {{ deleting ? '删除中...' : `确认删除 ${selected.size} 条` }}
        </button>
      </div>
    </div>
  </NModal>

  <!-- Tag Delete Confirm Modal -->
  <NModal v-model:show="showTagDeleteConfirm" :mask-style="{ backdropFilter: 'blur(8px)', background: 'rgba(0,0,0,0.6)' }">
    <div v-if="tagToDelete" class="mx-auto w-96 rounded-2xl border border-white/10 bg-[#0f0f19]/98 p-6 shadow-2xl backdrop-blur-xl">
      <div class="mb-4 flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/15 border border-red-400/20">
          <SvgIcon icon="ri:price-tag-3-line" class="text-lg text-red-400" />
        </div>
        <h3 class="text-base font-semibold text-slate-100">删除标签</h3>
      </div>

      <div class="space-y-3 text-sm text-slate-300">
        <p>
          确认删除标签 <span class="font-semibold text-violet-400"># {{ tagToDelete.tag }}</span> ？
        </p>
        <div class="rounded-xl border border-red-400/15 bg-red-500/[0.06] p-3">
          <p class="flex items-center gap-1.5 text-xs text-red-300/80">
            <SvgIcon icon="ri:error-warning-line" class="text-sm" />
            此操作将同时删除该标签下的 <span class="font-bold text-red-300">{{ tagToDelete.count }}</span> 条任务，删除后无法恢复！
          </p>
        </div>
      </div>

      <div class="mt-5 flex justify-end gap-2">
        <button
          class="glass-btn rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 backdrop-blur transition-all hover:bg-white/10"
          @click="showTagDeleteConfirm = false"
        >
          取消
        </button>
        <button
          class="rounded-lg border border-red-400/30 bg-red-500/20 px-4 py-2 text-sm font-medium text-red-300 transition-all hover:bg-red-500/30 disabled:opacity-50"
          :disabled="tagDeleting"
          @click="doDeleteTag"
        >
          <NSpin v-if="tagDeleting" size="small" class="mr-1.5" />
          {{ tagDeleting ? '删除中...' : '确认删除' }}
        </button>
      </div>
    </div>
  </NModal>

  <!-- Device Management Drawer -->
  <NDrawer v-model:show="showDevicePanel" placement="right" :width="380" :mask-style="{ backdropFilter: 'blur(6px)', background: 'rgba(0,0,0,0.5)' }">
    <NDrawerContent closable class="device-drawer">
      <template #header>
        <div class="flex items-center gap-2">
          <div class="flex h-6 w-6 items-center justify-center rounded-md bg-sky-500/15">
            <SvgIcon icon="ri:device-line" class="text-sm text-sky-400" />
          </div>
          <span class="text-sm font-semibold text-white/90">\u8bbe\u5907\u7ba1\u7406</span>
          <span class="rounded-md bg-white/8 px-1.5 py-0.5 text-[10px] text-white/40">{{ myDevices.length }}/{{ maxDevices }}</span>
        </div>
      </template>

      <div class="space-y-3">
        <p class="text-[11px] text-white/35">\u5f53\u524d\u7ed1\u5b9a\u7684\u8bbe\u5907\uff0c\u8d85\u8fc7\u4e0a\u9650\u9700\u89e3\u7ed1\u65e7\u8bbe\u5907\u624d\u80fd\u767b\u5f55\u65b0\u8bbe\u5907</p>

        <div v-if="devicesLoading" class="flex justify-center py-8">
          <NSpin size="small" />
        </div>

        <div v-else-if="myDevices.length === 0" class="py-8 text-center text-xs text-white/30">
          \u6682\u65e0\u8bbe\u5907\u8bb0\u5f55
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="device in myDevices"
            :key="device.id"
            class="group relative rounded-xl border p-3 transition-all"
            :class="device.isBlocked
              ? 'border-red-400/15 bg-red-500/[0.04]'
              : device.isTrusted
                ? 'border-sky-400/15 bg-sky-500/[0.04]'
                : 'border-white/8 bg-white/[0.02]'"
          >
            <div class="flex items-start justify-between">
              <div class="flex items-start gap-2.5">
                <div class="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg"
                  :class="device.isBlocked ? 'bg-red-500/10' : 'bg-white/5'">
                  <SvgIcon
                    :icon="device.os && device.os.includes('Windows') ? 'ri:computer-line'
                      : device.os && (device.os.includes('Mac') || device.os.includes('iOS')) ? 'ri:macbook-line'
                      : device.os && device.os.includes('Android') ? 'ri:smartphone-line'
                      : 'ri:device-line'"
                    class="text-base"
                    :class="device.isBlocked ? 'text-red-400/60' : 'text-white/40'"
                  />
                </div>
                <div>
                  <p class="text-xs font-medium" :class="device.isBlocked ? 'text-red-300/70' : 'text-white/80'">
                    {{ device.browser || '\u672a\u77e5\u6d4f\u89c8\u5668' }}
                    <span class="ml-1 text-white/30">{{ device.os || '' }}</span>
                  </p>
                  <p class="mt-0.5 text-[10px] text-white/25">
                    IP: {{ device.lastIp || '-' }}
                  </p>
                  <div class="mt-1 flex items-center gap-2 text-[10px]">
                    <span v-if="device.isTrusted" class="rounded-full border border-sky-400/20 bg-sky-500/10 px-1.5 py-0 text-sky-300/70">\u5df2\u4fe1\u4efb</span>
                    <span v-if="device.isBlocked" class="rounded-full border border-red-400/20 bg-red-500/10 px-1.5 py-0 text-red-300/70">\u5df2\u5c01\u7981</span>
                    <span class="text-white/20">\u6700\u540e\u6d3b\u8dc3 {{ formatDeviceTime(device.lastSeenAt) }}</span>
                  </div>
                </div>
              </div>

              <button
                v-if="!device.isBlocked"
                class="shrink-0 rounded-md border border-white/8 bg-white/[0.03] px-2 py-1 text-[10px] text-white/30 opacity-0 transition-all hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-300/70 group-hover:opacity-100"
                @click="removeDevice(device.id)"
              >
                \u89e3\u7ed1
              </button>
            </div>
          </div>
        </div>

        <!-- Usage hint -->
        <div class="rounded-xl border border-white/6 bg-white/[0.02] p-3">
          <p class="text-[11px] leading-relaxed text-white/30">
            <SvgIcon icon="ri:information-line" class="mr-0.5 inline text-xs text-white/20" />
            \u6bcf\u4e2a\u8d26\u53f7\u6700\u591a\u7ed1\u5b9a <span class="font-semibold text-white/50">{{ maxDevices }}</span> \u53f0\u8bbe\u5907\u3002\u89e3\u7ed1\u8bbe\u5907\u540e\u53ef\u5728\u65b0\u8bbe\u5907\u4e0a\u767b\u5f55\u3002\u5982\u9700\u8c03\u6574\u4e0a\u9650\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u3002
          </p>
        </div>
      </div>
    </NDrawerContent>
  </NDrawer>

<!-- Download Picker -->
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
          <p class="text-[13px] font-medium text-white/80">Runway 原链下载</p>
          <p class="text-[11px] text-white/30">从 Runway 生成链接直接下载，可能较慢</p>
        </div>
      </button>
      <p v-if="!directUrl && hasServerDownload" class="text-center text-[10px] text-white/20">当前任务只有服务器下载地址</p>
      <p v-if="!directUrl && !hasServerDownload" class="text-center text-[10px] text-white/20">暂无下载地址</p>
    </div>
  </NModal>

  <!-- Change Password -->
  <NModal v-model:show="showChangePwd" preset="card" title="修改密码" style="width: 360px; background: rgba(15,15,25,0.98); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px;" :segmented="{ content: true }">
    <div class="space-y-3 py-1">
      <div>
        <p class="mb-1 text-[11px] text-white/40">当前密码</p>
        <input v-model="oldPwd" type="password" placeholder="请输入当前密码" class="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] text-white/80 outline-none placeholder:text-white/20 focus:border-sky-400/30" />
      </div>
      <div>
        <p class="mb-1 text-[11px] text-white/40">新密码</p>
        <input v-model="newPwd" type="password" placeholder="至少6位" class="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] text-white/80 outline-none placeholder:text-white/20 focus:border-sky-400/30" />
      </div>
      <div>
        <p class="mb-1 text-[11px] text-white/40">确认新密码</p>
        <input v-model="confirmPwd" type="password" placeholder="再次输入新密码" class="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[13px] text-white/80 outline-none placeholder:text-white/20 focus:border-sky-400/30" @keyup.enter="changePassword" />
      </div>
      <button
        class="w-full rounded-lg border border-sky-400/20 bg-sky-500/10 py-2.5 text-[13px] font-medium text-sky-300 transition-all hover:bg-sky-500/20 disabled:opacity-40"
        :disabled="changePwdLoading"
        @click="changePassword"
      >
        {{ changePwdLoading ? '修改中...' : '确认修改' }}
      </button>
    </div>
  </NModal>

</template>
<style scoped>
/* Card entrance animation */
.job-card {
  animation: cardFadeIn 0.4s ease-out both;
}

@keyframes cardFadeIn {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Tab active indicator transition */
.tab-active-bg {
  animation: tabSlide 0.3s ease-out;
}

@keyframes tabSlide {
  from {
    opacity: 0;
    transform: scaleX(0.8);
  }
  to {
    opacity: 1;
    transform: scaleX(1);
  }
}

/* Processing dot pulse animation */
.processing-dot {
  animation: dotPulse 1.5s ease-in-out infinite;
}
.processing-dot-sm {
  animation: dotPulse 1.5s ease-in-out infinite;
}

@keyframes dotPulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.75);
  }
}

/* Shimmer skeleton overlay */
.shimmer-overlay {
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(56, 189, 248, 0.05) 40%,
    rgba(56, 189, 248, 0.10) 50%,
    rgba(56, 189, 248, 0.05) 60%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: shimmer 2s ease-in-out infinite;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

/* Progress bar glow effect */
.progress-glow {
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.25);
}

/* Empty state floating animation */
.empty-float {
  animation: floatUpDown 3s ease-in-out infinite;
}

@keyframes floatUpDown {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}

/* Glass button hover */
.glass-btn {
  transition: all 0.25s ease;
}

/* Action buttons */
.action-btn {
  transition: all 0.2s ease;
  backdrop-filter: blur(8px);
}
.action-btn:hover {
  transform: translateY(-1px) scale(1.02);
}
.action-btn:active {
  transform: scale(0.97);
}
.action-btn:focus-visible {
  outline: 2px solid rgba(56, 189, 248, 0.5);
  outline-offset: 2px;
}

/* User avatar subtle glow */
.user-avatar {
  box-shadow: 0 0 16px rgba(56, 189, 248, 0.15);
}

/* Confirm modal entrance */
.confirm-modal {
  animation: modalIn 0.25s ease-out;
}

@keyframes modalIn {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* Override Naive UI pagination in dark glass context */
:deep(.n-pagination .n-pagination-item) {
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  color: rgba(255, 255, 255, 0.6) !important;
  backdrop-filter: blur(8px);
}

:deep(.n-pagination .n-pagination-item--active) {
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.45), rgba(59, 130, 246, 0.45)) !important;
  border-color: rgba(56, 189, 248, 0.35) !important;
  color: #fff !important;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.2);
}

:deep(.n-pagination .n-pagination-item:hover:not(.n-pagination-item--active)) {
  background: rgba(255, 255, 255, 0.1) !important;
  border-color: rgba(56, 189, 248, 0.25) !important;
  color: rgba(255, 255, 255, 0.8) !important;
}

/* Override Naive UI checkbox accent */
:deep(.runway-checkbox .n-checkbox-box) {
  border-color: rgba(56, 189, 248, 0.25) !important;
  background: rgba(255, 255, 255, 0.05) !important;
}

:deep(.runway-checkbox .n-checkbox-box--checked) {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.7), rgba(99, 102, 241, 0.7)) !important;
  border-color: rgba(139, 92, 246, 0.5) !important;
}

/* Scrollbar styling for modal list */
.confirm-modal ::-webkit-scrollbar {
  width: 4px;
}
.confirm-modal ::-webkit-scrollbar-track {
  background: transparent;
}
.confirm-modal ::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

/* Detail drawer */
.detail-drawer :deep(.n-drawer-body-content-wrapper) {
  background: rgba(10, 12, 20, 0.98) !important;
}

.detail-drawer :deep(.n-drawer-header) {
  background: transparent !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.detail-row:last-child {
  border-bottom: none;
}

.detail-label {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.35);
  min-width: 64px;
}

.detail-value {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.80);
  text-align: right;
  word-break: break-all;
}

/* Video inline playback */
.video-thumb {
  transition: box-shadow 0.3s ease;
}



/* Card body hover glow line */
.card-body::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 16px;
  right: 16px;
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(56, 189, 248, 0.15), transparent);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.job-card:hover .card-body::after {
  opacity: 1;
}

/* Detail drawer enhancements */
:deep(.n-drawer) {
  background: rgba(10, 12, 20, 0.98) !important;
}

:deep(.n-drawer-header__main) {
  color: rgba(255, 255, 255, 0.9) !important;
}

/* Device Management Drawer */
.device-drawer :deep(.n-drawer-body-content-wrapper) {
  background: rgba(10, 12, 20, 0.98) !important;
}

.device-drawer :deep(.n-drawer-header) {
  background: transparent !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
}

/* Play button breathe */
.video-thumb:hover .play-breathe {
  animation: playBreathe 1.5s ease-in-out infinite;
}
@keyframes playBreathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}

/* Status-colored glow on card hover */
.job-card:hover {
  box-shadow: 0 8px 32px -8px rgba(0,0,0,0.4);
}

/* Dark scrollbar for the whole list */
.runway-list-root ::-webkit-scrollbar { width: 5px; }
.runway-list-root ::-webkit-scrollbar-track { background: transparent; }
.runway-list-root ::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.08);
  border-radius: 4px;
}
.runway-list-root ::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,0.15);
}

/* Detail row alternate bg */
.detail-row:nth-child(odd) {
  background: rgba(255,255,255,0.015);
  margin: 0 -4px;
  padding-left: 4px;
  padding-right: 4px;
  border-radius: 4px;
}

/* Delete icon shake */
.shake-icon {
  animation: shake 0.4s ease-in-out;
}
@keyframes shake {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-8deg); }
  75% { transform: rotate(8deg); }
}

/* Glass button focus */
.glass-btn:focus-visible {
  outline: 2px solid rgba(56, 189, 248, 0.4);
  outline-offset: 2px;
}
</style>
