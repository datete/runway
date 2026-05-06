<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { NAlert, NDrawer, NDrawerContent, NInput, NSpin, NSlider, NSwitch, useMessage } from 'naive-ui'
import { SvgIcon } from '@/components/common'
import { homeStore } from '@/store'
import { useRunwayJwt } from '@/composables/useRunwayJwt'

interface UploadedImage {
  id: string
  preview: string
  url: string
  uploading: boolean
}

interface TokenStatus {
  id: string
  index: number
  teamId: number
  expiresInDays: number | null
  expiringSoon: boolean
  inCooldown: boolean
  cooldownTtl: number
}
const MAX_IMAGES = 4
const HAPPYHORSE_MAX_IMAGES = 1
const BATCH_MAX_IMAGES = 10
const batchMode = ref(false)
const batchSubmitting = ref(false)
const batchProgress = ref({ current: 0, total: 0, success: 0, fail: 0 })

const message = useMessage()
const { headers: authHeaders, token: jwtToken, username: jwtUsername, role: jwtRole } = useRunwayJwt()

const loading = ref(false)
const submitSuccess = ref(false)
const prompt = ref('')
const remark = ref('')
const images = ref<UploadedImage[]>([])
const refVideoUrl = ref('')
const refVideoUploading = ref(false)
const refVideoPreview = ref('')
const exploreMode = ref(true)
const creditMode = ref(false)  // 积分生成模式（管理员专用，默认关闭 = 免费无限模式）
const isAdmin = computed(() => jwtRole.value === "admin")
type VideoModel = 'kling' | 'seedance' | 'happyhorse'
type HappyHorseRatio = '9:16' | '16:9' | '1:1' | '4:3' | '3:4'

const selectedModel = ref<VideoModel>('kling')
const duration = ref(5)
const resolution = ref('1076x1920')
const happyHorseRatio = ref<HappyHorseRatio>('9:16')
const happyHorseResolution = ref<'720p' | '1080p'>('1080p')
const quality = ref('std')
const sound = ref(false)
const cfgScale = ref(0.5)

// Pro mode: reference video

const stdResolutions = [
  { value: '1076x1920', label: '9:16', desc: '竖屏 1080p', iconW: 20, iconH: 34 },
]

const standardResolutions = [
  { value: '720x1280', label: '9:16', desc: '竖屏 720p', iconW: 20, iconH: 34 },
  { value: '1280x720', label: '16:9', desc: '横屏 720p', iconW: 34, iconH: 20 },
]
const happyHorseRatios = [
  { value: '9:16', label: '9:16', desc: '竖屏', iconW: 20, iconH: 34 },
  { value: '16:9', label: '16:9', desc: '横屏', iconW: 34, iconH: 20 },
  { value: '1:1', label: '1:1', desc: '方形', iconW: 26, iconH: 26 },
  { value: '4:3', label: '4:3', desc: '经典', iconW: 30, iconH: 23 },
  { value: '3:4', label: '3:4', desc: '竖幅', iconW: 23, iconH: 30 },
]
const happyHorseResolutionOptions = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
] as const
const resolutionOptions = computed(() => {
  if (selectedModel.value === 'seedance') return [{ value: '720p', label: '9:16', desc: '720p', iconW: 20, iconH: 34 }]
  if (selectedModel.value === 'happyhorse') return happyHorseRatios
  if (quality.value === 'standard') return standardResolutions
  return stdResolutions
})
const selectedAspectValue = computed(() => selectedModel.value === 'happyhorse' ? happyHorseRatio.value : resolution.value)
const selectAspectOption = (value: string) => {
  if (selectedModel.value === 'happyhorse') {
    happyHorseRatio.value = value as HappyHorseRatio
  } else {
    resolution.value = value
  }
}

watch(selectedModel, (m) => {
  if (m === 'seedance') {
    resolution.value = '720p'
    quality.value = 'std'
  } else if (m === 'happyhorse') {
    happyHorseRatio.value = '9:16'
    quality.value = 'std'
    happyHorseResolution.value = '1080p'
    if (!batchMode.value && images.value.length > HAPPYHORSE_MAX_IMAGES) {
      images.value = images.value.slice(0, HAPPYHORSE_MAX_IMAGES)
    }
    removeRefVideo()
  } else {
    resolution.value = '1076x1920'
    removeRefVideo()
  }
})

watch(quality, (q) => {
  if (selectedModel.value !== 'kling') return
  if (q === 'standard' && !standardResolutions.find(r => r.value === resolution.value)) resolution.value = '720x1280'
  if (q !== 'standard' && resolution.value !== '1076x1920') resolution.value = '1076x1920'
})



const durationHints: Record<number, string> = {
  5: '适合产品展示、短镜头动作，生成速度最快',
  10: '适合完整动作展示、多步骤演示，推荐日常使用',
  15: '适合复杂场景、长镜头叙事，生成时间较长',
}

const modelHints: Record<VideoModel, string> = {
  kling: '可灵 3.0 Pro — 高画质 1080p，支持标准/Pro模式，精确提示词控制',
  seedance: 'Seedance 2.0 — ByteDance 出品，720p，支持参考图+视频，自带音效生成',
  happyhorse: 'HappyHorse 1.0 — 支持文生视频和起始帧图生视频，可选比例与 720p/1080p',
}

const selectedModelLabel = computed(() => {
  if (selectedModel.value === 'seedance') return 'Seedance 2.0'
  if (selectedModel.value === 'happyhorse') return 'HappyHorse 1.0'
  return '可灵 3.0'
})



const qualityHints: Record<string, string> = {
  standard: '标准模式 — Kling 3.0 普通版，720p 分辨率，生成速度更快，消耗更少配额',
  std: 'Pro 模式 — 基于参考图片生成视频，最高 1080p 分辨率，适合大多数场景，消耗 1 个配额',
}

const cfgHint = computed(() => {
  const v = cfgScale.value
  if (v <= 0.3) return '低关联度 — AI 自由发挥空间大，动作更自然流畅，但可能偏离提示词描述'
  if (v <= 0.6) return '平衡模式 — 推荐大多数场景使用，兼顾提示词准确性和画面自然度'
  return '高关联度 — 严格遵循提示词，适合精确控制动作和构图，但可能导致画面僵硬'
})

const tokenWarnings = ref<string[]>([])
const activeTasks = ref(0)
const maxConcurrency = ref(2)
const tokenList = ref<TokenStatus[]>([])
let tokenTimer: ReturnType<typeof setInterval> | null = null

const dailyUsed = ref(0)
const dailyQuotaUsed = ref(0)
const systemDailyTotal = ref(0)
const dailyQuota = ref<number | null>(null)
const totalUsed = ref(0)
const totalQuota = ref<number | null>(null)

const isUploading = computed(() => images.value.some((item) => item.uploading))
const uploadedUrls = computed(() => images.value.filter((item) => item.url).map((item) => item.url))
const modelMaxImages = computed(() => selectedModel.value === 'happyhorse' ? HAPPYHORSE_MAX_IMAGES : MAX_IMAGES)
const remainingSlots = computed(() => Math.max(0, (batchMode.value ? BATCH_MAX_IMAGES : modelMaxImages.value) - images.value.length))


const promptLength = computed(() => prompt.value.length)
const PROMPT_MAX_LENGTH = 2000
const promptHint = computed(() => {
  if (promptLength.value === 0) return ''
  if (promptLength.value < 10) return '建议更详细地描述'
  if (promptLength.value > PROMPT_MAX_LENGTH) return `提示词超出上限（${promptLength.value}/${PROMPT_MAX_LENGTH}），请精简后再提交`
  if (promptLength.value > 500) return '提示词较长，可能影响效果'
  return ''
})

const canSubmit = computed(() => {
  if (!jwtToken.value) return false
  if (!prompt.value.trim()) return false
  if (batchMode.value && uploadedUrls.value.length === 0) return false
  if (loading.value || isUploading.value || batchSubmitting.value) return false
  if (quotaExceeded.value) return false
  if (promptLength.value > PROMPT_MAX_LENGTH) return false
  return true
})

const canSubmitReason = computed(() => {
  if (!jwtToken.value) return '请先登录后再提交任务'
  if (loading.value || batchSubmitting.value) return '正在提交任务，请稍候'
  if (isUploading.value) return '参考图片上传中，请稍候'
  if (quotaExceeded.value) return quotaExceeded.value
  if (promptLength.value > PROMPT_MAX_LENGTH) return `提示词超出${PROMPT_MAX_LENGTH}字上限（当前${promptLength.value}字），请精简后再提交`
  if (!prompt.value.trim()) return '请输入提示词'
  if (batchMode.value && uploadedUrls.value.length === 0) return '批量模式下请至少上传一张参考图（每张图 = 一个任务）'
  return ''
})

const completionItems = computed(() => [
  { key: 'prompt', label: '提示词', done: Boolean(prompt.value.trim()) },
  { key: 'images', label: '参考图', done: uploadedUrls.value.length > 0 },
])

const completionRatio = computed(() => {
  const total = completionItems.value.length
  const done = completionItems.value.filter((item) => item.done).length
  return Math.round((done / total) * 100)
})

const submitShortcutLabel = computed(() => {
  if (typeof navigator === 'undefined') return 'Ctrl + Enter'
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
  return isMac ? '⌘ + Enter' : 'Ctrl + Enter'
})

const concurrencyLabel = computed(() => {
  if (tokenList.value.length <= 1) return `并发任务 ${activeTasks.value}/${maxConcurrency.value}`
  return `并发任务 ${activeTasks.value}/${maxConcurrency.value} · 通道 ${tokenList.value.length} 个`
})

const concurrencyClass = computed(() => {
  if (activeTasks.value >= maxConcurrency.value) return 'text-amber-500 dark:text-amber-400'
  if (activeTasks.value > 0) return 'text-cyan-600 dark:text-cyan-400'
  return 'text-slate-500 dark:text-slate-400'
})

const quotaLabel = computed(() => {
  const parts: string[] = []
  if (dailyQuota.value !== null) {
    parts.push(`今日 ${dailyQuotaUsed.value}/${dailyQuota.value}`)
  } else {
    parts.push(`今日生成 ${dailyUsed.value}`)
  }
  if (totalQuota.value !== null) {
    parts.push(`总计 ${totalUsed.value}/${totalQuota.value}`)
  }
  return parts.join(' · ') || null
})

const quotaExceeded = computed(() => {
  if (dailyQuota.value !== null && dailyQuotaUsed.value >= dailyQuota.value) return '今日配额已用完'
  if (totalQuota.value !== null && totalUsed.value >= totalQuota.value) return '总配额已用完'
  return null
})

const quotaWarning = computed(() => {
  if (quotaExceeded.value) return null
  if (dailyQuota.value !== null && dailyQuotaUsed.value >= dailyQuota.value * 0.8) {
    return `今日配额即将用完（${dailyQuotaUsed.value}/${dailyQuota.value}）`
  }
  if (totalQuota.value !== null && totalUsed.value >= totalQuota.value * 0.8) {
    return `总配额即将用完（${totalUsed.value}/${totalQuota.value}）`
  }
  return null
})

const createUid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

const uploadFlash = ref<Set<string>>(new Set())

const updateImage = (id: string, patch: Partial<UploadedImage>) => {
  const index = images.value.findIndex((item) => item.id === id)
  if (index < 0) return
  const wasUploading = images.value[index].uploading
  images.value[index] = { ...images.value[index], ...patch }
  // Flash green on upload complete
  if (wasUploading && patch.uploading === false && patch.url) {
    uploadFlash.value.add(id)
    setTimeout(() => { uploadFlash.value.delete(id) }, 1200)
  }
}

const removeImageById = (id: string) => {
  images.value = images.value.filter((item) => item.id !== id)
}

const fetchTokenStatus = async () => {
  if (!jwtToken.value) {
    activeTasks.value = 0
    maxConcurrency.value = 2
    tokenList.value = []
    tokenWarnings.value = []
    dailyUsed.value = 0
    dailyQuotaUsed.value = 0
    systemDailyTotal.value = 0
    dailyQuota.value = null
    totalUsed.value = 0
    totalQuota.value = null
    return
  }

  try {
    const res = await fetch('/api/runway/token-status', { headers: authHeaders() })
    if (!res.ok) return

    const data = await res.json()
    activeTasks.value = data.activeTasks ?? 0
    maxConcurrency.value = data.maxConcurrency ?? 2
    dailyUsed.value = data.dailyUsed ?? 0
    dailyQuotaUsed.value = data.dailyQuotaUsed ?? data.dailyUsed ?? 0
    systemDailyTotal.value = data.systemDailyTotal ?? 0
    dailyQuota.value = data.dailyQuota ?? null
    totalUsed.value = data.totalUsed ?? 0
    totalQuota.value = data.totalQuota ?? null
    tokenList.value = data.tokens || []
    tokenWarnings.value = (data.tokens || [])
      .map((token: TokenStatus) => {
        if (token.expiringSoon && (token.expiresInDays ?? 0) <= 0) {
          return `通道 ${token.index} 的令牌今日到期，请尽快更新`
        }
        if (token.expiringSoon) {
          return `通道 ${token.index} 的令牌将在 ${token.expiresInDays} 天内到期`
        }
        if (token.inCooldown) {
          return `通道 ${token.index} 冷却中，剩余 ${token.cooldownTtl} 秒`
        }
        return ''
      })
      .filter(Boolean)
  } catch {
    // silent
  }
}

const handleFileSelect = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const fileList = Array.from(input.files || []).slice(0, remainingSlots.value)
  if (fileList.length === 0) return
  processFiles(fileList)
  input.value = ''
}

const removeImage = (index: number) => {
  images.value.splice(index, 1)
}

const removeAllImages = () => {
  images.value = []
  uploadFlash.value.clear()
}

const handleVideoSelect = async (e: Event) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('video/')) { message.warning('请选择视频文件'); return }
  if (file.size > 50 * 1024 * 1024) { message.error('视频文件最大 50MB'); return }
  refVideoUploading.value = true
  refVideoPreview.value = URL.createObjectURL(file)
  try {
    const reader = new FileReader()
    const base64: string = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    const res = await fetch('/api/runway/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ data: base64, filename: file.name }),
    })
    if (!res.ok) { let m = ''; try { const j = await res.json(); m = j?.error || j?.message || '' } catch {} ; throw new Error(m || `上传失败（${res.status}）`) }
    const data = await res.json()
    refVideoUrl.value = data.url
    message.success('参考视频上传成功')
  } catch (e: any) {
    message.error(e.message || '视频上传失败')
    refVideoUrl.value = ''
    refVideoPreview.value = ''
  } finally {
    refVideoUploading.value = false
  }
}

const removeRefVideo = () => {
  refVideoUrl.value = ''
  refVideoPreview.value = ''
}

// Drag-and-drop support
const isDragging = ref(false)
let dragCounter = 0

const onDragEnter = (e: DragEvent) => {
  e.preventDefault()
  dragCounter++
  if (e.dataTransfer?.types.includes('Files')) isDragging.value = true
}
const onDragLeave = (e: DragEvent) => {
  e.preventDefault()
  dragCounter--
  if (dragCounter <= 0) { isDragging.value = false; dragCounter = 0 }
}
const onDragOver = (e: DragEvent) => { e.preventDefault() }
const onDrop = (e: DragEvent) => {
  e.preventDefault()
  isDragging.value = false
  dragCounter = 0
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  // Filter to images only
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, remainingSlots.value)
  if (imageFiles.length === 0) { message.warning('请拖入图片文件'); return }
  // Reuse handleFileSelect logic
  processFiles(imageFiles)
}

const processFiles = async (fileList: File[]) => {
  for (const file of fileList) {
    const id = createUid()
    images.value.push({ id, preview: '', url: '', uploading: true })

    const reader = new FileReader()
    reader.onload = async (readerEvent) => {
      const base64 = String(readerEvent.target?.result || '')
      if (!base64) {
        removeImageById(id)
        message.error(`图片读取失败：${file.name}`)
        return
      }
      updateImage(id, { preview: base64 })
      const img = new Image()
      img.src = base64
      img.onload = () => {
        if (img.width < 300 || img.height < 300) {
          message.error(`图片 ${file.name} 尺寸太小(${img.width}x${img.height})，系统要求至少300x300px`, { duration: 6000 })
        } else if (img.width > img.height) {
          message.warning(`图片 ${file.name} 为横屏(${img.width}x${img.height})，建议上传竖屏(9:16)图片以获得最佳效果`, { duration: 5000 })
        }
      }
      try {
        const uploadRes = await fetch('/api/runway/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ data: base64, filename: file.name }),
        })
        if (!uploadRes.ok) throw new Error('上传失败')
        const uploadData = await uploadRes.json()
        updateImage(id, { url: uploadData.url, uploading: false })
      } catch (error: any) {
        removeImageById(id)
        message.error(`上传失败：${error.message || file.name}`)
      }
    }
    reader.readAsDataURL(file)
  }
}


// ── AI Prompt Optimization ──
const showAiOptimize = ref(false)
const aiAutoOptimize = ref(false)
const aiExtraRequest = ref('')
const aiStyleTags = ref<string[]>([])
const aiGenerating = ref(false)
const aiResult = ref('')
const aiStreamText = ref('')
const aiPendingSubmit = ref(false)
const aiError = ref('')
const aiThinking = ref(false)
const aiFollowUp = ref('')
const aiOriginalPrompt = ref('')
const aiMessages = ref<Array<{role: 'user' | 'assistant'; content: string}>>([])
const aiChatScrollEl = ref<HTMLElement | null>(null)

// ── Session Memory: persist AI conversation within browser tab ──
const AI_SESSION_KEY = 'runway_ai_opt_session'

const saveAiSession = () => {
  try {
    const session = {
      messages: aiMessages.value,
      skill: selectedSkill.value,
      extraRequest: aiExtraRequest.value,
      lastResult: aiResult.value,
      originalPrompt: aiOriginalPrompt.value,
      ts: Date.now(),
    }
    sessionStorage.setItem(AI_SESSION_KEY, JSON.stringify(session))
  } catch {}
}

const restoreAiSession = (): boolean => {
  try {
    const raw = sessionStorage.getItem(AI_SESSION_KEY)
    if (!raw) return false
    const session = JSON.parse(raw)
    // Expire after 30 minutes
    if (Date.now() - session.ts > 30 * 60 * 1000) {
      sessionStorage.removeItem(AI_SESSION_KEY)
      return false
    }
    if (session.messages?.length > 0) {
      aiMessages.value = session.messages
      selectedSkill.value = session.skill || null
      aiExtraRequest.value = session.extraRequest || ''
      aiResult.value = session.lastResult || ''
      aiStreamText.value = session.lastResult || ''
      aiOriginalPrompt.value = session.originalPrompt || ''
      return true
    }
  } catch {}
  return false
}

const clearAiSession = () => {
  sessionStorage.removeItem(AI_SESSION_KEY)
  aiMessages.value = []
  aiResult.value = ''
  aiStreamText.value = ''
  aiFollowUp.value = ''
  aiError.value = ''
}
const aiDrawerBodyEl = ref<HTMLElement | null>(null)

const AI_SKILLS = [
  // 常用场景
  { id: 'action', icon: 'ri:body-scan-line', label: '动作优化', desc: '优化人物动作，更好展示商品', hint: '优化人物动作，让展示商品的动作更自然流畅，聚焦商品展示', group: '常用' },
  { id: 'camera', icon: 'ri:camera-lens-line', label: '镜头优化', desc: '优化镜头运动和构图', hint: '优化镜头语言，用推拉摇移等运镜手法更好地展示商品全貌和细节', group: '常用' },
  { id: 'product', icon: 'ri:shopping-bag-3-line', label: '产品特写', desc: '镜头聚焦产品，展示细节质感', hint: '镜头缓慢推近产品，聚焦展示产品质感和细节，柔和光影', group: '常用' },
  { id: 'handshow', icon: 'ri:hand-coin-line', label: '手部展示', desc: '手持/触摸商品，展示细节', hint: '手部细致展示商品，拿起、翻转、触摸材质、按压质感，突出手与商品的互动', group: '动作' },
  { id: 'catwalk', icon: 'ri:walk-line', label: '走秀步态', desc: '模特步态展示穿搭', hint: '模特自信走来，展示服装穿着效果，自然步态和转身，全身和半身切换', group: '动作' },
  { id: 'pickup', icon: 'ri:gift-line', label: '拿取展示', desc: '自然拿起商品展示', hint: '人物自然伸手拿起商品，举到镜头前展示，转动展示各角度，表情自然', group: '动作' },
  { id: 'wear', icon: 'ri:shirt-line', label: '穿戴过程', desc: '展示穿戴/使用过程', hint: '展示穿上/戴上/使用商品的完整过程，动作流畅自然，镜头跟随', group: '动作' },
  { id: 'interact', icon: 'ri:user-smile-line', label: '互动种草', desc: '对镜展示+推荐', hint: '人物面向镜头，自然展示商品同时配合推荐的表情动作，真实感染力', group: '动作' },
  { id: 'kol', icon: 'ri:user-smile-line', label: '达人展示', desc: '自然真实，达人原生感', hint: '达人自然展示，保持真实原生感，非摆拍的自然动作和表情', group: '常用' },
  { id: 'ecom', icon: 'ri:store-2-line', label: '电商带货', desc: '突出卖点，刺激购买', hint: '电商风格展示，突出产品卖点和使用场景，吸引购买', group: '常用' },
  { id: 'outfit', icon: 'ri:t-shirt-2-line', label: '穿搭展示', desc: '模特走动展示穿搭效果', hint: '模特走动展示穿搭，全身展示服装搭配效果，自然步态', group: '常用' },
  // 达人原生感
  { id: 'dailylife', icon: 'ri:home-smile-2-line', label: '日常生活', desc: '居家/出门，自然随拍', hint: '日常生活随拍，居家或出门场景，自然状态的人物动作，不经意间的镜头感', group: '达人' },
  { id: 'street', icon: 'ri:walk-line', label: '街拍随拍', desc: '街头漫步，自然抓拍', hint: '街头漫步随拍风格，人物走在街道上，自然的步伐和姿态，城市背景虚化', group: '达人' },
  { id: 'tryout', icon: 'ri:hand-heart-line', label: '试用体验', desc: '真实使用产品过程', hint: '真实试用体验场景，自然拿起产品仔细查看、试用、感受，真实反应和表情', group: '达人' },
  { id: 'mirror', icon: 'ri:camera-line', label: '镜前自拍', desc: '镜子前展示，真实感', hint: '镜前自拍风格，人物在全身镜前展示穿搭或状态，手机入镜更真实', group: '达人' },
  { id: 'closeup', icon: 'ri:user-heart-line', label: '口播种草', desc: '面对镜头推荐讲解', hint: '口播种草风格，人物面对镜头自然讲解推荐，表情生动，手势配合展示产品', group: '达人' },
  { id: 'compare', icon: 'ri:contrast-2-line', label: '对比展示', desc: '前后对比，效果直观', hint: '对比展示风格，分屏或先后对比产品使用前后效果，直观呈现差异', group: '达人' },
  // 创意拍摄
  { id: 'unbox', icon: 'ri:gift-line', label: '开箱展示', desc: '拆箱过程，首次体验', hint: '开箱展示过程，从拆封到展示产品，突出第一印象和惊喜感', group: '创意' },
  { id: 'mood', icon: 'ri:movie-2-line', label: '氛围大片', desc: '电影感运镜，质感画面', hint: '电影感运镜大片，精致的光影氛围，高质感画面，情绪渲染', group: '创意' },
  { id: 'detail', icon: 'ri:zoom-in-line', label: '细节微距', desc: '超近距离展示纹理材质', hint: '微距镜头展示材质纹理细节，慢速推近，突出工艺品质', group: '创意' },
  { id: 'cinematic', icon: 'ri:film-line', label: '电影叙事', desc: '故事性镜头语言', hint: '电影叙事风格，有故事性的镜头语言，情节推进感，悬念和张力', group: '创意' },
  // 场景环境
  { id: 'scene', icon: 'ri:landscape-line', label: '场景展示', desc: '展示环境和空间氛围', hint: '镜头展示完整场景和空间，从远景到近景的自然过渡', group: '场景' },
  { id: 'food', icon: 'ri:restaurant-line', label: '美食展示', desc: '食物特写，诱人质感', hint: '美食特写展示，热气腾腾的质感，诱人的色泽和光影，慢动作倾倒或切开', group: '场景' },
  { id: 'travel', icon: 'ri:road-map-line', label: '旅行Vlog', desc: '旅行记录，风景人文', hint: '旅行Vlog风格，风景与人文结合，手持跟拍，自然随性的记录感', group: '场景' },
  { id: 'sport', icon: 'ri:run-line', label: '运动活力', desc: '运动场景，动感十足', hint: '运动活力场景，动态捕捉运动瞬间，速度感，慢动作回放精彩瞬间', group: '场景' },
  // 风格调性
  { id: 'minimal', icon: 'ri:contrast-line', label: '极简高级', desc: '留白构图，高级质感', hint: '极简高级风格，大量留白，简洁构图，冷淡色调，突出产品本身', group: '风格' },
  { id: 'vintage', icon: 'ri:ancient-gate-line', label: '复古怀旧', desc: '胶片质感，暖色调', hint: '复古怀旧风格，胶片颗粒感，暖黄色调，慢节奏，有年代感的氛围', group: '风格' },
  { id: 'tech', icon: 'ri:cpu-line', label: '科技未来', desc: '科技感，未来风格', hint: '科技未来风格，冷色调光效，数码元素，流线型运镜，现代感十足', group: '风格' },
  { id: 'cute', icon: 'ri:bear-smile-line', label: '可爱萌系', desc: '萌趣风格，轻松活泼', hint: '可爱萌系风格，明亮柔和色调，活泼跳跃的节奏，轻松有趣的动作', group: '风格' },
]

const selectedSkill = ref<string | null>(null)
const skillsExpanded = ref(false)

const selectSkill = (skillId: string) => {
  if (selectedSkill.value === skillId) {
    selectedSkill.value = null
    return
  }
  selectedSkill.value = skillId
  const skill = AI_SKILLS.find(s => s.id === skillId)
  if (skill) {
    aiStyleTags.value = [skill.label]
    if (!aiExtraRequest.value.trim()) {
      aiExtraRequest.value = skill.hint
    }
  }
}


const highlightKeywords = (text: string) => {
  const keywords = [
    '镜头', '推近', '拉远', '环绕', '平移', '俯拍', '仰拍', '跟拍', '横移', '升降', '运镜',
    '动作', '走动', '转身', '拿起', '放下', '展示', '抬手', '挥手', '甩动', '整理', '触摸',
    '光线', '光影', '侧光', '逆光', '柔光', '高光', '暖光', '冷光',
    '特写', '微距', '全景', '中景', '近景', '景深', '虚化',
    '慢动作', '缓慢', '流畅', '自然',
  ]
  let result = text.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  for (const kw of keywords) {
    result = result.replace(new RegExp(kw, 'g'), `<span style="color:#7dd3fc;font-weight:600">${kw}</span>`)
  }
  return result
}

const pickRandom = (arr: string[], n: number) => {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n)
}

// Dimension definitions for gap analysis
interface HintDimension {
  name: string        // dimension label shown as tag prefix
  detect: RegExp      // if matched, this dimension is covered
  icon: string        // for potential UI use
  hints: string[]     // suggestions when this dimension is MISSING
}

const HINT_DIMENSIONS: HintDimension[] = [
  {
    name: '动作',
    detect: /走|跑|转身|回头|站|坐|蹲|拿|举|抬|挥|甩|摸|抚|整理|拉扯|靠|倚|挽|捧|按|点|触|系|脱|穿|戴|涂|擦|揉|撩|甩头|弯腰|伸手|叉腰|踮脚|迈步|跨|踩|蹬|摆手|招手|鼓掌|托|推|拉|搂|吹/,
    icon: 'ri:body-scan-line',
    hints: [
      '加入自然走动', '加个转身动作', '人物拿起产品展示',
      '加入手部动作', '伸手整理衣服', '微微侧身展示',
      '边走边展示', '加个甩头动作', '从坐到站起身',
      '轻轻抬手触摸产品', '往前迈两步', '低头再抬头看镜头',
    ],
  },
  {
    name: '镜头',
    detect: /镜头|推近|拉远|环绕|平移|跟拍|俯拍|仰拍|横移|升降|运镜|航拍|固定|手持|摇|移|dollly|pan|tilt|zoom/,
    icon: 'ri:camera-lens-line',
    hints: [
      '加入镜头从远推近', '来个环绕展示一圈', '镜头从上到下扫过',
      '加入跟随人物的跟拍', '从特写拉远到全景', '镜头慢慢横移',
      '加个从低往高升起的镜头', '手持跟拍增加临场感',
    ],
  },
  {
    name: '景别',
    detect: /特写|微距|全景|远景|中景|近景|半身|全身|大特写|景深|虚化|焦点|对焦/,
    icon: 'ri:focus-3-line',
    hints: [
      '加入特写细节镜头', '从全景推到近景', '浅景深虚化背景',
      '中景切到面部特写', '微距展示材质纹理', '景深变化突出主体',
      '从模糊到清晰的对焦', '全身到半身的景别变化',
    ],
  },
  {
    name: '光影',
    detect: /光|影|照|亮|暗|阴|逆光|侧光|柔光|暖光|冷光|高光|轮廓光|顶光|底光|自然光|日落|金色|晨光|月光|灯光|霓虹|光晕|光斑|丁达尔/,
    icon: 'ri:sun-line',
    hints: [
      '加入柔和侧光', '逆光勾勒轮廓', '暖黄色夕阳光',
      '冷白自然光', '加入明暗对比', '光线从窗户洒入',
      '加点光斑/光晕效果', '灯光缓缓亮起',
    ],
  },
  {
    name: '节奏',
    detect: /慢|缓|快|急|停|定格|节奏|速度|加速|减速|慢动作|延时|流畅|连贯/,
    icon: 'ri:speed-line',
    hints: [
      '加入慢动作瞬间', '节奏先慢后快', '关键动作放慢',
      '快慢交替有节奏感', '结尾定格两秒', '从静止突然启动',
      '动作之间停顿一下',
    ],
  },
  {
    name: '氛围',
    detect: /氛围|情绪|感觉|气氛|基调|格调|质感|电影|大片|高级|复古|科技|梦幻|浪漫|文艺|街头|日系|韩系|ins风/,
    icon: 'ri:palette-line',
    hints: [
      '氛围更电影感', '加入复古胶片质感', '更有高级感',
      '日系清新风格', '街头潮酷氛围', '梦幻柔焦效果',
      '更有故事感和情绪', '科技未来风',
    ],
  },
  {
    name: '场景',
    detect: /场景|背景|环境|室内|室外|街道|咖啡|海边|森林|都市|天台|楼梯|走廊|窗|门|桌|椅|沙发|草地|公园|店|市场/,
    icon: 'ri:landscape-line',
    hints: [
      '加入背景环境描述', '窗帘轻轻飘动', '背景行人走过',
      '加入环境声音暗示', '树叶或光影在背景晃动',
      '场景从室内切到室外', '远处有城市天际线',
    ],
  },
  {
    name: '表情',
    detect: /表情|微笑|笑|眼神|嘴角|皱眉|凝视|注视|回望|对视|闭眼|睁|眨|歪头|点头|摇头/,
    icon: 'ri:emotion-line',
    hints: [
      '加入自然微笑', '眼神看向远方', '回头望一眼镜头',
      '表情从平静到微笑', '嘴角微微上扬', '轻轻闭眼再睁开',
      '歪头带点俏皮', '眼神有故事感',
    ],
  },
  {
    name: '产品',
    detect: /产品|商品|logo|标签|材质|面料|质地|纹理|弹力|垂感|光泽|细节|工艺|缝线|拉链|按钮|口袋|内衬/,
    icon: 'ri:shopping-bag-3-line',
    hints: [
      '突出产品细节和质感', '镜头聚焦到logo', '展示面料材质纹理',
      '手指触摸展示质感', '拉扯展示弹力', '光线扫过产品表面',
      '展示产品的特殊工艺', '对比展示产品前后效果',
    ],
  },
  {
    name: '构图',
    detect: /构图|三分|居中|对称|留白|前景|框架|引导线|对角|黄金|比例|画面|画幅/,
    icon: 'ri:layout-grid-line',
    hints: [
      '用三分法构图', '加入前景元素增加层次', '大面积留白更高级',
      '利用门框/窗框做框架构图', '对称构图', '对角线构图增加动感',
    ],
  },
]

const dynamicHints = computed(() => {
  const fixed = ['动作快一点', '重新更换动作', '内容再详细一点']
  const lastAi = [...aiMessages.value].reverse().find(m => m.role === 'assistant')
  const text = lastAi?.content || aiResult.value || ''
  if (!text) return [...fixed, ...pickRandom(['加入镜头运动', '描述光影', '加入动作', '突出质感', '补充氛围'], 3)]

  // Find missing dimensions
  const missing: { name: string; hints: string[] }[] = []
  const covered: { name: string; hints: string[] }[] = []

  for (const dim of HINT_DIMENSIONS) {
    if (dim.detect.test(text)) {
      // Covered but can still offer tweaks (lower priority)
      covered.push({ name: dim.name, hints: dim.hints })
    } else {
      // Missing — high priority suggestions
      missing.push({ name: dim.name, hints: dim.hints })
    }
  }

  const result: string[] = []

  // Priority 1: pick 1 hint from each missing dimension (up to 4)
  const topMissing = missing.slice(0, 4)
  for (const m of topMissing) {
    const pick = pickRandom(m.hints, 1)[0]
    if (pick) result.push(pick)
  }

  // Priority 2: if still room, pick from covered dimensions as tweaks
  if (result.length < 5) {
    const tweakPool: string[] = []
    for (const c of covered) tweakPool.push(...c.hints)
    const tweaks = pickRandom(tweakPool, 5 - result.length)
    result.push(...tweaks)
  }

  // Deduplicate
  const unique = [...new Set(result)].slice(0, 5)
  return [...fixed, ...unique]
})

const openAiOptimize = () => {
  aiOriginalPrompt.value = prompt.value.trim()
  aiGenerating.value = false
  aiError.value = ''
  aiPendingSubmit.value = false
  aiThinking.value = false
  aiFollowUp.value = ''

  // Try to restore previous session (same browser tab)
  const restored = restoreAiSession()
  if (!restored) {
    // Fresh start
    aiExtraRequest.value = ''
    aiStyleTags.value = []
    aiResult.value = ''
    aiStreamText.value = ''
    aiMessages.value = []
    selectedSkill.value = null
  }
  showAiOptimize.value = true
}

const handleSubmitWithAi = async () => {
  if (aiAutoOptimize.value && images.value.length > 0 && images.value[0].preview) {
    openAiOptimize()
    aiPendingSubmit.value = true
    // Default to 动作优化 skill when auto-triggered
    if (!selectedSkill.value) {
      selectSkill('action')
    }
    // Auto-trigger AI generation
    await nextTick()
    await generateAiPrompt()
  } else {
    submit()
  }
}

const generateAiFollowUp = async () => {
  const text = aiFollowUp.value.trim()
  if (!text) return
  aiMessages.value.push({ role: 'user', content: text })
  aiFollowUp.value = ''
  await doAiGenerate(text)
}

const generateAiPrompt = async () => {
  const validImages = images.value.filter(img => img.preview)
  if (validImages.length === 0) {
    message.warning('请先上传参考图片')
    return
  }
  // Keep previous messages as context for regeneration (don't wipe)
  if (aiMessages.value.length === 0) {
    await doAiGenerate(null)
  } else {
    // Regenerate = treat as follow-up preserving all prior optimization context
    aiMessages.value.push({ role: 'user', content: '请基于之前的讨论重新生成一版，保留之前提出的所有优化方向，生成一个更好的版本。' })
    await doAiGenerate('请基于之前的讨论重新生成一版，保留之前提出的所有优化方向，生成一个更好的版本。')
  }
}

// Compress image for AI vision (max 768px, JPEG 0.7)
const compressForVision = (base64: string, maxSize = 768): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement("canvas")
      canvas.width = w; canvas.height = h
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL("image/jpeg", 0.7))
    }
    img.onerror = () => resolve(base64) // fallback to original
    img.src = base64
  })
}

let aiGenerateLock = false
const doAiGenerate = async (followUpText: string | null) => {
  if (aiGenerateLock) {
    console.log('[AI-OPT] doAiGenerate already running, skipping')
    return
  }
  aiGenerateLock = true
  const validImages = images.value.filter(img => img.preview)
  aiGenerating.value = true
  aiThinking.value = true
  aiStreamText.value = ''
  aiResult.value = ''
  aiError.value = ''
  nextTick(() => { const el = aiDrawerBodyEl.value || aiChatScrollEl.value; el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) })

  let abortTimer: ReturnType<typeof setTimeout> | undefined
  try {
  // Build skill-aware system prompt
  const skill = selectedSkill.value ? AI_SKILLS.find(s => s.id === selectedSkill.value) : null

  const SKILL_PROMPTS: Record<string, string> = {
    action: `【动作优化模式】
重点：优化人物动作，让商品展示更专业有效。分析图片中的商品类型，生成最适合展示该商品的动作描述。
- 服装类：走动、转身、拉扯面料展示弹力、整理衣领/袖口、自然甩动展示垂感
- 鞋类：抬脚展示、走路展示步态、蹲下系鞋带、侧面展示鞋型
- 包/配饰：拿起展示、打开展示内部、搭配穿搭、手部特写
- 美妆/护肤：涂抹过程、按压取用、展示质地、使用前后对比
动作要求：自然不僵硬、有节奏感、动作间过渡流畅、始终让商品处于画面焦点。`,

    camera: `【镜头优化模式】
重点：用专业运镜手法最大化展示商品。根据商品类型选择最佳镜头策略。
- 整体展示：中景→特写的推镜、环绕展示360°全貌
- 细节展示：微距推近纹理材质、浅景深突出细节
- 动态展示：跟随人物移动的跟拍镜头、平行移动的横移镜头
- 氛围营造：从远景拉近的戏剧性推镜、低角度仰拍增加气势
镜头要求：运动平稳流畅、速度节奏有变化（快→慢→停）、始终保持商品在黄金构图位置。`,

    product: `【产品特写模式】
重点：镜头从中景缓慢推近到产品特写，展示材质、质感、光泽。柔和侧光或逆光突出轮廓和细节。背景简洁干净。如果是食品饮料可加入蒸汽、水珠等动态元素。运镜：慢速环绕、推近、微距切换。`,

    kol: `【达人原生感模式】
重点：人物动作自然生活化（走路、转身、微笑、整理衣物）。避免摆拍感，强调抓拍质感。场景真实（居家/咖啡店/街道）。镜头跟随人物移动，轻微晃动增加真实感。光线自然。`,

    ecom: `【电商带货模式】
重点：产品和人物都要出镜，展示使用产品的过程。动作清晰有目的性（拆包、试穿、试用、效果对比）。镜头在人物和产品间切换，特写产品卖点。背景简洁明亮。`,

    outfit: `【穿搭展示模式】
重点：模特全身入镜，走路/转身展示服装整体效果。镜头从头到脚缓慢扫过展示搭配细节。步态自然优雅，可加入甩头、整理衣领等动作。光线柔和均匀突出服装颜色和材质。`,

    unbox: `【开箱展示模式】
重点：手部动作为主（拆开包装、取出产品、翻转查看）。俯拍或平视桌面，干净桌面背景。慢动作展示拆封过程营造期待感。产品取出后给特写。光线明亮柔和。`,

    mood: `【氛围大片模式】
重点：电影级运镜（推拉摇移、跟拍、升降、环绕长镜头）。黄金时段暖光、逆光剪影、冷暖对比。慢动作+正常速度交替。景深变化虚实结合。画面构图精致。`,

    scene: `【场景展示模式】
重点：镜头从远景到近景，或从入口进入空间的跟随镜头。平稳缓慢移动展示空间全貌和细节。自然光透过窗户。加入环境元素（窗帘飘动、水面波纹、植物微动）。`,

    detail: `【细节微距模式】
重点：超近距离拍摄展示材质纹理。极浅景深焦点在细节上背景完全虚化。慢速平移或缓慢推近。侧光勾勒纹理、逆光穿透材质。适合布料编织、皮革纹路、金属光泽。`,

    cinematic: `【电影叙事模式】
重点：有故事性的镜头语言，强调情节推进。镜头从某个细节或画外音起始，缓慢揭示主体。光影有对比（明暗交替），景深变化突出叙事节奏。有起承转合的镜头节奏。可加入人物回望、推门、走入光线等动作。`,

    food: `【美食展示模式】
重点：食物必须看起来诱人。微距展示食材纹理、色泽、光泽。加入动态元素（蒸汽升腾、酱汁浇淋、芝士拉丝、刀切截面、液体倾倒）。俯拍+平视切换，暖色调灯光，浅景深突出食物主体。`,

    travel: `【旅行Vlog模式】
重点：手持跟拍风格，自然晃动增加真实感。风景大全景+人物中景交替。金色时段自然光。人物走向镜头或背对镜头走向远方的构图。加入转场动作（手挡镜头、快速平移）。节奏轻松随性。`,

    sport: `【运动活力模式】
重点：快速运动场景捕捉。慢动作拍摄关键瞬间（跳跃、奔跑、击球、翻转）。多角度切换（仰拍显力量、跟拍显速度）。强对比光线，汗水/水花飞溅等动态元素。节奏快，剪辑感强。`,

    minimal: `【极简高级模式】
重点：大量留白构图，画面元素极少。纯色/浅色背景。产品或人物居中或三分法构图。慢速平移或静止镜头。冷淡色调（白/灰/米色为主）。光线均匀柔和无明显阴影。动作极简克制。`,

    vintage: `【复古怀旧模式】
重点：胶片质感画面（轻微颗粒、色彩偏暖黄/橙调）。镜头可加入轻微暗角和色散。慢节奏缓慢运镜。怀旧场景元素（老建筑、复古家具、黑胶唱片）。自然光或钨丝灯暖光。人物动作缓慢优雅。`,

    tech: `【科技未来模式】
重点：冷色调（蓝/紫/青）光效。产品悬浮或置于暗色科技感台面上。光线从侧面或底部打出轮廓光。可加入光线扫过表面的动态效果。运镜精准流畅（无人机式环绕或线性平移）。背景暗色突出产品。`,

    cute: `【可爱萌系模式】
重点：明亮柔和的色调（粉/白/浅蓝/浅黄）。人物表情生动活泼（眨眼、歪头、比心）。轻微过曝的柔光效果。节奏轻快跳跃。可加入弹跳动作或翻转动作。背景温馨干净。`,

    dailylife: `【日常生活模式】
重点：居家或日常外出场景，人物处于自然放松状态。动作不刻意（喝咖啡、整理物品、看窗外、翻书）。镜头稍有距离感，像朋友在旁边随手拍。自然光为主，不打灯。场景真实有生活气息。`,

    street: `【街拍随拍模式】
重点：街头场景，人物自然行走。镜头跟随或等待人物走入画面。浅景深虚化城市背景。自然步态不看镜头或偶尔回眸。光线取决于实际环境（阳光/阴天/夜景都可）。手持跟拍微晃增加随拍感。`,

    tryout: `【试用体验模式】
重点：人物真实拿起产品，仔细端详、触摸、试用。表情和反应要自然真实（微微点头、露出满意神情）。镜头在人物面部和产品之间切换。特写手部操作细节。场景居家或办公桌，光线自然。`,

    mirror: `【镜前自拍模式】
重点：全身镜前展示，镜像画面。人物一手持手机（手机入镜增加真实感），另一手展示穿搭或造型。自然的照镜子姿势（侧身、转身、整理头发/衣服）。卧室或衣帽间场景，自然光。`,

    closeup: `【口播种草模式】
重点：人物面部中近景，直面镜头讲解。表情自然生动有感染力。手部动作配合展示产品（举起产品、指向细节、比划大小）。背景简洁不抢眼。光线明亮均匀，突出人物肤质。`,

    compare: `【对比展示模式】
重点：对比前后效果。先展示使用前状态（平铺、未使用），然后展示使用中/后的效果（上身效果、使用效果）。镜头在两个状态间切换或分屏呈现。对比要直观有冲击力。光线一致确保对比公平。`,

    handshow: `【手部展示模式】
重点：手部动作为画面核心。手指轻触商品表面展示材质，拿起旋转展示各角度，按压展示弹性/质感。镜头跟随手部移动，微距特写指尖与商品接触的细节。光线侧打突出质感和手部线条。节奏缓慢细腻。`,

    catwalk: `【走秀步态模式】
重点：模特从远处走向镜头或横穿画面，展示服装穿着效果。步态自信优雅有节奏感。镜头先给全身展示整体搭配，然后推近展示上半身或细节。可加入自然转身、回眸。场景简洁不抢眼，光线均匀突出服装。`,

    pickup: `【拿取展示模式】
重点：人物自然地从桌面/架子/包装中拿起商品，举到合适位置展示。动作要自然不做作，像是日常发现好物的状态。拿起后缓慢转动展示各个角度，表情带有欣赏/满意感。镜头从中景到特写。`,

    wear: `【穿戴过程模式】
重点：完整展示穿上/戴上/涂上商品的过程。动作连贯流畅有仪式感。例如：拿起眼镜→慢慢戴上→调整→照镜子；拿起外套→套入→整理→展示效果。镜头跟随动作关键节点，注意穿戴前后对比。`,

    interact: `【互动种草模式】
重点：人物面对镜头，像和朋友视频聊天一样自然展示商品。表情生动真实，有眼神交流感。手势配合展示（指向细节、翻转展示、贴近脸旁对比）。节奏轻松自然，像真实的推荐分享。背景简洁居家感。`,
  }

  const skillSection = skill ? '\n' + (SKILL_PROMPTS[skill.id] || '') : ''

  // Dynamic length control: detect user intent for longer/shorter prompts from ALL sources
  const prevUserMessages = aiMessages.value.filter(m => m.role === 'user').map(m => m.content).join(' ')
  const allUserText = (aiExtraRequest.value + ' ' + (followUpText || '') + ' ' + prompt.value + ' ' + prevUserMessages).toLowerCase()
  const wantsLonger = /长一[点些]|详细[一点些]|丰富[一点些]|多写[一点些]|写长|更长|更详细|字数多|内容多|多一[点些]描述/.test(allUserText)
  const wantsShorter = /短一[点些]|简洁|精简|简短|少写|写短/.test(allUserText)
  let lengthGuide = '120-200字'
  let lengthNote = ''
  if (wantsLonger) {
    lengthGuide = '200-350字'
    lengthNote = '\n⚠️ 用户明确要求更长更详细的提示词，你必须输出至少200字，尽可能丰富地描述画面的每个元素：主体细节、多段动作序列、镜头运动轨迹变化、光影层次、环境氛围细节。不要偷懒缩短。'
  } else if (wantsShorter) {
    lengthGuide = '50-80字'
    lengthNote = '\n用户希望简洁精炼的提示词，保留核心元素即可。'
  }

  const systemPrompt = `你是专业的AI视频生成提示词专家，专精于可灵（Kling）等国产AI视频生成平台。分析参考图片，结合用户需求，生成最优的视频提示词。

## 可灵视频提示词关键要素（按重要性排序）

1. **主体** — 精确描述画面中最重要的人/物（外观特征、姿态、服装、材质颜色）
2. **动作** — 具体的动作描述（不是"展示产品"而是"双手捧起产品缓慢转动展示各角度"）
3. **镜头运动** — 动态运镜（"镜头从中景缓慢推近至特写"而不是"近景拍摄"）
4. **光影** — 光线方向和质感（"柔和侧窗自然光在表面形成温暖高光"）
5. **氛围节奏** — 整体风格基调和时间节奏
${skillSection}
## 输出要求

- 直接输出提示词，不要标题、序号、解释、前缀
- 中文输出，${lengthGuide}
- 具体有画面感 — 读完脑中能看到这个视频
- 动作要具体可执行（"轻轻拿起杯子啜饮"✓  "展示产品"✗）
- 镜头用动态词（"缓慢推近""环绕平移"✓  "近景""特写"✗）
- 描述要连贯如一个完整的视频片段，有起承转合${lengthNote}`

  // Build user message with all images
  const userContent: Array<{type: string; image_url?: {url: string}; text?: string}> = []

  // Add all reference images (max 4)
  for (const img of validImages.slice(0, 4)) {
    const compressed = await compressForVision(img.preview)
    userContent.push({ type: 'image_url', image_url: { url: compressed } })
  }

  // Build text instruction
  let userText = '请仔细分析' + (validImages.length > 1 ? `这${validImages.length}张参考图片` : '这张参考图片') + '，'
  userText += '识别画面中的主体（人物特征/产品类型/场景环境），然后生成视频提示词。\n\n'

  if (prompt.value.trim()) {
    userText += '用户当前填写的提示词（在此基础上优化）：\n「' + prompt.value.trim() + '」\n\n'
  }

  if (skill) {
    userText += '用户选择的视频风格：' + skill.label + ' — ' + skill.desc + '\n请严格按照该风格要求生成提示词。\n\n'
  }

  if (aiExtraRequest.value.trim()) {
    userText += '用户的额外要求（必须满足）：' + aiExtraRequest.value.trim() + '\n\n'
  }

  if (!prompt.value.trim() && !skill && !aiExtraRequest.value.trim()) {
    userText += '用户没有指定特定方向，请根据图片内容自动判断最合适的视频风格和镜头语言。'
  }

  userContent.push({ type: 'text', text: userText })

  const abortCtrl = new AbortController()
  abortTimer = setTimeout(() => abortCtrl.abort(), 90000)
  {
    const wantDetail = followUpText && /详细|更长|多一点|展开|丰富/.test(followUpText)
    const tokenLimit = wantDetail ? 2000 : 800
    const res = await fetch('/api/runway/ai/optimize', {
      method: 'POST',
      signal: abortCtrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders()
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        stream: true,
        max_tokens: tokenLimit,
        messages: followUpText
          ? [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
              ...aiMessages.value.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
              { role: "user", content: wantDetail ? followUpText + "\n\n请输出200-1000字的详细版本，覆盖动作、镜头、景别、光影、节奏、氛围、表情、构图等多个维度，尽量丰富。" : followUpText }
            ]
          : [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent }
            ]
      })
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error('API错误: ' + res.status + ' ' + errText.slice(0, 100))
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error('无法读取响应流')

    const decoder = new TextDecoder()
    let buffer = ''

    const streamTimeout = 120000 // 120s max wait per chunk
    while (true) {
      const readPromise = reader.read()
      const timeoutPromise = new Promise<{done: true; value: undefined}>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), streamTimeout)
      )
      const { done, value } = await Promise.race([readPromise, timeoutPromise])
      if (done) {
        if (!aiStreamText.value) throw new Error('AI服务响应超时，请重试')
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            if (aiThinking.value) aiThinking.value = false
            aiStreamText.value += delta
          }
        } catch {}
      }
    }

    aiResult.value = aiStreamText.value
    // Save to conversation history
    aiMessages.value.push({ role: 'assistant', content: aiResult.value })
    // Scroll to bottom to show compare panel and action buttons
    setTimeout(() => { const el = aiDrawerBodyEl.value || aiChatScrollEl.value; el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }, 100)
    nextTick(() => { const el = aiDrawerBodyEl.value || aiChatScrollEl.value; el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) })
  } // end fetch block
  } catch (err: any) {
    const msg = err.message || 'AI生成失败'
    if (err.name === 'AbortError' || msg.includes('504') || msg.includes('timeout') || msg.includes('abort')) {
      aiError.value = 'AI服务响应超时，请稍后重试'
    } else if (msg.includes('500')) {
      aiError.value = 'AI服务暂时不可用，请稍后重试'
    } else {
      aiError.value = msg
    }
    message.error(aiError.value)
  } finally {
    if (abortTimer) clearTimeout(abortTimer)
    aiGenerating.value = false
    aiThinking.value = false
    aiGenerateLock = false
  }
}


const applyAiResult = (andSubmit = false) => {
  // Use the latest AI message from conversation
  const lastAi = [...aiMessages.value].reverse().find(m => m.role === 'assistant')
  const text = (lastAi?.content || aiResult.value || aiStreamText.value).trim()
  if (!text) return
  prompt.value = text
  showAiOptimize.value = false
  message.success('提示词已应用')
  if (andSubmit) {
    setTimeout(() => submit(), 100)
  }
}


const submit = async () => {
  if (!canSubmit.value) return
  loading.value = true
  try {
    const isSeedance = selectedModel.value === 'seedance'
    const isHappyHorse = selectedModel.value === 'happyhorse'
    const hasImage = uploadedUrls.value.length > 0
    const payload = {
      prompt: prompt.value.trim(),
      mode: hasImage ? 'image_to_video' : 'text_to_video',
      model: isSeedance ? 'seedance_2' : isHappyHorse ? 'happyhorse_1_0' : undefined,
      exploreMode: creditMode.value ? false : exploreMode.value,
      duration: duration.value,
      resolution: isHappyHorse ? happyHorseRatio.value : (resolution.value || undefined),
      quality: isHappyHorse ? happyHorseResolution.value : isSeedance ? 'std' : quality.value,
      cfgScale: isSeedance || isHappyHorse ? undefined : cfgScale.value,
      sound: isHappyHorse ? undefined : sound.value,
      remark: remark.value.trim() || undefined,
      imageUrls: uploadedUrls.value,
      videoUrl: isHappyHorse ? undefined : (refVideoUrl.value || undefined),
    }
    const res = await fetch('/api/runway/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    })
    if (!res.ok) { let m = ''; try { const j = await res.json(); m = j?.error || j?.message || '' } catch {} ; throw new Error(m || `任务提交失败（${res.status}）`) }
    message.success('任务已提交，正在排队处理')
    submitSuccess.value = true
    setTimeout(() => { submitSuccess.value = false }, 3000)
    prompt.value = ''
    remark.value = ''
    images.value = []
    removeRefVideo()
    homeStore.setMyData({ act: 'RunwayMvpRefresh' })
    fetchTokenStatus()
  } catch (error: any) {
    message.error(error.message || '任务提交失败')
  } finally {
    loading.value = false
  }
}

const batchSubmit = async () => {
  if (!canSubmit.value || !batchMode.value) return
  const urls = uploadedUrls.value.slice()
  if (urls.length < 2) {
    // Only 1 image, use normal submit
    return submit()
  }
  batchSubmitting.value = true
  batchProgress.value = { current: 0, total: urls.length, success: 0, fail: 0 }
  let lastBatchErrorMsg = ''
  const isSeedance = selectedModel.value === 'seedance'
  const isHappyHorse = selectedModel.value === 'happyhorse'
  const basePayload = {
    prompt: prompt.value.trim(),
    mode: 'image_to_video',
    model: isSeedance ? 'seedance_2' : isHappyHorse ? 'happyhorse_1_0' : undefined,
    exploreMode: creditMode.value ? false : exploreMode.value,
    duration: duration.value,
    resolution: isHappyHorse ? happyHorseRatio.value : (resolution.value || undefined),
    quality: isHappyHorse ? happyHorseResolution.value : isSeedance ? 'std' : quality.value,
    cfgScale: isSeedance || isHappyHorse ? undefined : cfgScale.value,
    sound: isHappyHorse ? undefined : sound.value,
    remark: remark.value.trim() || undefined,
    videoUrl: isHappyHorse ? undefined : (refVideoUrl.value || undefined),
  }
  for (let i = 0; i < urls.length; i++) {
    batchProgress.value.current = i + 1
    try {
      const res = await fetch('/api/runway/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ...basePayload, imageUrls: [urls[i]] }),
      })
      if (!res.ok) { let m = ''; try { const j = await res.json(); m = j?.error || j?.message || '' } catch {} ; throw new Error(m || `提交失败（${res.status}）`) }
      batchProgress.value.success++
    } catch (e: any) {
      batchProgress.value.fail++
      lastBatchErrorMsg = e?.message || '提交失败'
    }
  }
  const { success, fail } = batchProgress.value
  if (success > 0) {
    message.success(`批量提交完成：${success} 个成功` + (fail > 0 ? `，${fail} 个失败` : ''))
    submitSuccess.value = true
    setTimeout(() => { submitSuccess.value = false }, 3000)
    prompt.value = ''
    remark.value = ''
    images.value = []
    removeRefVideo()
    homeStore.setMyData({ act: 'RunwayMvpRefresh' })
    fetchTokenStatus()
  } else {
    message.error(lastBatchErrorMsg ? `批量提交全部失败：${lastBatchErrorMsg}` : '批量提交全部失败')
  }
  batchSubmitting.value = false
}

const handleSubmitHotkey = (event: KeyboardEvent) => {
  const enterPressed = event.key === 'Enter' || event.code === 'Enter'
  if (event.isComposing) return
  if (!enterPressed || (!event.ctrlKey && !event.metaKey)) return
  if (showAiOptimize.value || !canSubmit.value) return
  event.preventDefault()
  handleSubmitWithAi()
}

onMounted(() => {
  fetchTokenStatus()
  tokenTimer = setInterval(fetchTokenStatus, 15000)
  window.addEventListener('keydown', handleSubmitHotkey)
})
onUnmounted(() => {
  if (tokenTimer) clearInterval(tokenTimer)
  window.removeEventListener('keydown', handleSubmitHotkey)
})
</script>

<template>
  <div class="mvp-panel flex flex-col gap-3 p-4 h-full overflow-y-auto" :class="{ 'panel-ready': canSubmit }">

    <!-- Submit Success Animation Bar -->
    <Transition name="success-bar">
      <div v-if="submitSuccess" class="success-bar">
        <div class="success-bar-content">
          <SvgIcon icon="ri:check-line" class="text-sm" />
          <span>任务已提交，排队生成中...</span>
        </div>
        <div class="success-bar-progress" />
      </div>
    </Transition>


    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="header-icon">
          <SvgIcon icon="ri:vidicon-line" class="text-base" />
        </div>
        <div class="flex flex-col">
          <span class="text-sm font-semibold text-white/90 tracking-wide">视频创作</span>
          <span class="text-[10px] text-white/35 leading-tight">{{ selectedModelLabel }} · {{ batchMode ? '批量' : '单任务' }}</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div class="today-badge" :title="`今日累计生成任务数（含已删除）`">
          <SvgIcon icon="ri:flashlight-line" class="text-[11px] text-amber-300" />
          <span class="text-[10px] text-white/50">今日生成</span>
          <span class="text-sm font-bold tabular-nums text-amber-300">{{ dailyUsed }}</span>
        </div>
        <div class="system-badge" :title="`全站今日完成数（status=completed,按完成时间）`">
          <SvgIcon icon="ri:global-line" class="text-[11px] text-sky-300" />
          <span class="text-[10px] text-white/50">系统今日完成</span>
          <span class="text-sm font-bold tabular-nums text-sky-300">{{ systemDailyTotal }}</span>
        </div>
      </div>
    </div>

    <div class="section-divider" />

    <!-- 批量模式切换 -->
    <div class="flex items-center justify-between rounded-xl border px-3.5 py-2.5 transition-all duration-300 cursor-pointer"
      :class="batchMode
        ? 'border-violet-400/30 bg-gradient-to-r from-violet-500/[0.08] to-fuchsia-500/[0.05]'
        : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'"
      @click="batchMode = !batchMode; images = []"
    >
      <div class="flex items-center gap-2">
        <div class="flex h-6 w-6 items-center justify-center rounded-lg"
          :class="batchMode ? 'bg-violet-500/20' : 'bg-white/[0.05]'">
          <SvgIcon :icon="batchMode ? 'ri:stack-fill' : 'ri:stack-line'"
            class="text-sm" :class="batchMode ? 'text-violet-400' : 'text-white/30'" />
        </div>
        <div class="flex flex-col">
          <span class="text-[11px] font-semibold" :class="batchMode ? 'text-violet-300/90' : 'text-white/50'">
            {{ batchMode ? '批量模式 — 每张图一个任务' : '单任务模式' }}
          </span>
          <span class="text-[9px]" :class="batchMode ? 'text-violet-300/40' : 'text-white/25'">
            {{ batchMode ? `可上传最多 ${BATCH_MAX_IMAGES} 张图片` : selectedModel === 'happyhorse' ? `最多 ${HAPPYHORSE_MAX_IMAGES} 张起始帧` : `最多 ${MAX_IMAGES} 张参考图` }}
          </span>
        </div>
      </div>
      <div class="flex h-5 w-9 items-center rounded-full px-0.5 transition-all duration-300"
        :class="batchMode ? 'bg-violet-500/40 justify-end' : 'bg-white/10 justify-start'">
        <div class="h-4 w-4 rounded-full transition-all duration-300 shadow"
          :class="batchMode ? 'bg-violet-300' : 'bg-white/40'" />
      </div>
    </div>

    <div class="section-divider" />

    <!-- 用户信息 -->
    <div class="user-chip">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0 flex items-center gap-2">
          <div class="status-dot" :class="{ 'dot-active': jwtToken }"></div>
          <div class="min-w-0">
            <p class="truncate text-xs font-semibold text-white/85">{{ jwtToken ? jwtUsername : '未登录' }}</p>
            <p class="text-[10px] text-white/35">{{ jwtRole === 'admin' ? '管理员账号' : '普通账号' }}</p>
          </div>
        </div>
        <div class="flex flex-col items-end gap-0.5">
          <span :class="['text-[11px] font-medium', concurrencyClass]">{{ concurrencyLabel }}</span>
          <span v-if="quotaLabel" class="text-[10px] text-white/35">{{ quotaLabel }}</span>
        </div>
      </div>

      <!-- 配额进度条 -->
      <div v-if="dailyQuota !== null || totalQuota !== null" class="mt-2 flex flex-col gap-1.5">
        <div v-if="dailyQuota !== null" class="flex items-center gap-2">
          <span class="text-[10px] text-white/30 w-8 shrink-0">日配</span>
          <div class="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="dailyQuotaUsed >= dailyQuota ? 'bg-red-400/80' : dailyQuotaUsed >= dailyQuota * 0.8 ? 'bg-amber-400/70' : 'bg-sky-400/60'"
              :style="{ width: Math.min(100, Math.round(dailyQuotaUsed / dailyQuota * 100)) + '%' }"
            />
          </div>
          <span class="text-[10px] tabular-nums" :class="dailyQuotaUsed >= dailyQuota ? 'text-red-400/80' : 'text-white/30'">{{ dailyQuotaUsed }}/{{ dailyQuota }}</span>
        </div>
        <div v-if="totalQuota !== null" class="flex items-center gap-2">
          <span class="text-[10px] text-white/30 w-8 shrink-0">总配</span>
          <div class="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="totalUsed >= totalQuota ? 'bg-red-400/80' : totalUsed >= totalQuota * 0.8 ? 'bg-amber-400/70' : 'bg-sky-400/60'"
              :style="{ width: Math.min(100, Math.round(totalUsed / totalQuota * 100)) + '%' }"
            />
          </div>
          <span class="text-[10px] tabular-nums" :class="totalUsed >= totalQuota ? 'text-red-400/80' : 'text-white/30'">{{ totalUsed }}/{{ totalQuota }}</span>
        </div>
      </div>

      <template v-if="tokenWarnings.length">
        <NAlert v-for="(warn, i) in tokenWarnings" :key="i" type="warning" class="mt-2 text-xs">{{ warn }}</NAlert>
      </template>
      <NAlert v-if="quotaExceeded" type="error" class="mt-2 text-xs">{{ quotaExceeded }}</NAlert>
      <NAlert v-else-if="quotaWarning" type="warning" class="mt-2 text-xs">{{ quotaWarning }}</NAlert>
    </div>

    <div class="section-divider" />

    <!-- 提示词 -->
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between">
        <label class="section-label">提示词 *</label>
        <button
          type="button"
          class="ai-opt-btn group flex items-center gap-1.5 rounded-lg border border-sky-400/25 bg-gradient-to-r from-sky-500/10 to-blue-500/10 px-3 py-1.5 text-[11px] font-semibold text-sky-300/85 transition-all duration-300 hover:border-sky-400/40 hover:from-sky-500/20 hover:to-blue-500/20 hover:text-sky-200 hover:shadow-lg hover:shadow-sky-500/12 hover:-translate-y-0.5 active:scale-95"
          @click="openAiOptimize"
        >
          <SvgIcon icon="ri:magic-line" class="text-xs transition-transform duration-200 group-hover:rotate-12" />
          AI优化
        </button>
      </div>

      <div class="textarea-wrapper">
        <NInput
          v-model:value="prompt"
          type="textarea"
          placeholder="描述你想要生成的视频内容，例如：一只猫在窗台上看雨，镜头缓缓推近..."
          :autosize="{ minRows: 3, maxRows: 6 }"
          class="prompt-textarea"
        />
        <div class="mt-1 flex items-center justify-between">
          <p v-if="promptHint" class="text-[10px]" :class="promptLength > 500 ? 'text-amber-400/70' : 'text-white/25'">{{ promptHint }}</p>
          <span v-else class="text-[10px] text-white/20">快捷提交：{{ submitShortcutLabel }}</span>
          <div class="flex items-center gap-2">
            <button
              v-if="promptLength > 0"
              type="button"
              class="ghost-action-btn"
              @click="prompt = ''"
            >
              清空
            </button>
            <span class="text-[10px] font-mono" :class="promptLength > 0 ? 'text-sky-400/50' : 'text-white/15'">{{ promptLength }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="section-divider" />

    <!-- 参考图片 - 拖拽上传 -->
    <div class="flex flex-col gap-1.5">
      <label class="section-label">{{ batchMode ? "批量图片 *（每张图 = 一个任务）" : selectedModel === 'seedance' ? '参考图片（可选，可上传多张）' : selectedModel === 'happyhorse' ? `起始帧（可选，最多 ${HAPPYHORSE_MAX_IMAGES} 张）` : `参考图片 *（最多 ${MAX_IMAGES} 张）` }}</label>
      <div v-if="images.length > 0" class="mb-0.5 flex items-center justify-between">
        <p class="text-[10px] text-white/30">
          已上传 {{ uploadedUrls.length }}/{{ images.length }} 张
          <span v-if="batchMode && uploadedUrls.length > 1" class="text-violet-400/70"> · 将创建 {{ uploadedUrls.length }} 个任务</span>
        </p>
        <button
          type="button"
          class="ghost-action-btn"
          :disabled="isUploading"
          @click="removeAllImages"
        >
          清空图片
        </button>
      </div>
      <div
        class="img-drop-zone relative rounded-xl border-2 border-dashed p-3 transition-all duration-300"
        :class="[
          isDragging ? 'border-sky-400/60 bg-sky-500/[0.08] scale-[1.01]' : 'border-white/[0.08] bg-white/[0.02]',
          isUploading ? 'is-uploading' : ''
        ]"
        @dragenter="onDragEnter"
        @dragleave="onDragLeave"
        @dragover="onDragOver"
        @drop="onDrop"
      >
        <!-- Drag overlay -->
        <Transition name="hint-fade">
          <div v-if="isDragging" class="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-sky-500/[0.12] backdrop-blur-sm">
            <SvgIcon icon="ri:download-2-line" class="mb-1 text-2xl text-sky-400 animate-bounce" />
            <p class="text-[12px] font-semibold text-sky-300">松手上传图片</p>
          </div>
        </Transition>

        <!-- Image grid -->
        <div v-if="images.length > 0" class="grid gap-2" :class="images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'">
          <div
            v-for="(img, idx) in images"
            :key="img.id"
            class="group relative overflow-hidden rounded-lg border transition-all duration-300"
            :class="[
              uploadFlash.has(img.id) ? 'border-emerald-400/60 shadow-lg shadow-emerald-500/20' : 'border-white/10 hover:border-white/20',
              images.length === 1 ? 'h-40' : 'h-24'
            ]"
          >
            <img v-if="img.preview" :src="img.preview" class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
            <div v-if="img.uploading" class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/50 backdrop-blur-sm">
              <NSpin size="small" />
              <span class="text-[10px] text-white/40">上传中...</span>
            </div>
            <div v-else class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <button
              v-if="!img.uploading"
              type="button"
              class="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white/70 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/80 hover:text-white"
              @click="removeImage(idx)"
            >
              <SvgIcon icon="ri:close-line" class="text-xs" />
            </button>
            <div v-if="img.url && !img.uploading" class="absolute bottom-1 left-1 flex items-center gap-0.5 rounded-md bg-black/50 px-1 py-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <SvgIcon icon="ri:check-line" class="text-[10px] text-emerald-400" />
              <span class="text-[9px] text-emerald-300/80">已上传</span>
            </div>
          </div>
        </div>

        <!-- Upload button / empty state -->
        <label
          v-if="remainingSlots > 0"
          class="upload-trigger mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.12] bg-white/[0.03] py-3 transition-all duration-300 hover:border-sky-400/40 hover:bg-sky-500/[0.06] hover:shadow-md hover:shadow-sky-500/5"
          :class="{ 'mt-0': images.length === 0 }"
        >
          <SvgIcon icon="ri:image-add-line" class="text-base text-white/25" />
          <span class="text-[11px] text-white/30">{{ images.length === 0 ? '点击或拖拽上传参考图片' : `还可上传 ${remainingSlots} 张` }}</span>
          <input type="file" accept="image/*" multiple class="hidden" @change="handleFileSelect" />
        </label>
      </div>
    </div>

    <!-- 参考视频 (Seedance) -->
    <div v-if="selectedModel === 'seedance'" class="flex flex-col gap-1.5">
      <label class="section-label">参考视频（可选）</label>
      <div v-if="refVideoPreview" class="relative rounded-xl border border-emerald-400/20 bg-black/20 overflow-hidden">
        <video :src="refVideoPreview" class="w-full max-h-32 object-contain" controls />
        <div v-if="refVideoUploading" class="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <NSpin size="small" />
          <span class="ml-2 text-[10px] text-white/60">上传中...</span>
        </div>
        <button
          v-if="!refVideoUploading"
          class="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white/70 transition-all hover:bg-red-500/80 hover:text-white"
          @click="removeRefVideo"
        >
          <SvgIcon icon="ri:close-line" class="text-sm" />
        </button>
        <div v-if="refVideoUrl" class="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/50 px-1.5 py-0.5">
          <SvgIcon icon="ri:check-line" class="text-[10px] text-emerald-400" />
          <span class="text-[9px] text-emerald-300/80">已上传</span>
        </div>
      </div>
      <label v-else class="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-400/15 bg-emerald-500/[0.03] py-3 transition-all hover:border-emerald-400/30 hover:bg-emerald-500/[0.06]">
        <SvgIcon icon="ri:video-add-line" class="text-base text-emerald-400/40" />
        <span class="text-[11px] text-emerald-300/40">上传参考视频（mp4/mov，最大 50MB）</span>
        <input type="file" accept="video/mp4,video/quicktime,video/x-msvideo" class="hidden" @change="handleVideoSelect" />
      </label>
    </div>

    <div class="section-divider" />

    <!-- 模型选择 -->
    <div class="flex flex-col gap-2">
      <label class="section-label">模型</label>
      <div class="grid grid-cols-2 gap-2">
        <button
          class="group flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2.5 text-left transition-all duration-200"
          :class="selectedModel === 'kling'
            ? 'border-sky-400/40 bg-gradient-to-br from-sky-500/[0.08] to-blue-500/[0.05] shadow-md shadow-sky-500/8'
            : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'"
          @click="selectedModel = 'kling'"
        >
          <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-all"
            :class="selectedModel === 'kling' ? 'bg-sky-500/20' : 'bg-white/[0.05]'">
            <SvgIcon icon="ri:video-ai-line" class="text-base"
              :class="selectedModel === 'kling' ? 'text-sky-400' : 'text-white/30'" />
          </div>
          <div class="flex min-w-0 flex-col">
            <span class="truncate whitespace-nowrap text-[11px] font-semibold" :class="selectedModel === 'kling' ? 'text-sky-300' : 'text-white/50'">可灵 3.0</span>
            <span class="truncate whitespace-nowrap text-[9px]" :class="selectedModel === 'kling' ? 'text-sky-400/50' : 'text-white/25'">最高 1080p</span>
          </div>
        </button>
        <button
          class="group flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2.5 text-left transition-all duration-200"
          :class="selectedModel === 'seedance'
            ? 'border-emerald-400/40 bg-gradient-to-br from-emerald-500/[0.08] to-teal-500/[0.05] shadow-md shadow-emerald-500/8'
            : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'"
          @click="selectedModel = 'seedance'"
        >
          <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-all"
            :class="selectedModel === 'seedance' ? 'bg-emerald-500/20' : 'bg-white/[0.05]'">
            <SvgIcon icon="ri:seedling-line" class="text-base"
              :class="selectedModel === 'seedance' ? 'text-emerald-400' : 'text-white/30'" />
          </div>
          <div class="flex min-w-0 flex-col">
            <span class="truncate whitespace-nowrap text-[11px] font-semibold" :class="selectedModel === 'seedance' ? 'text-emerald-300' : 'text-white/50'">Seedance 2.0</span>
            <span class="truncate whitespace-nowrap text-[9px]" :class="selectedModel === 'seedance' ? 'text-emerald-400/50' : 'text-white/25'">720p · 含音效</span>
          </div>
        </button>
        <button
          class="group col-span-2 flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2.5 text-left transition-all duration-200"
          :class="selectedModel === 'happyhorse'
            ? 'border-fuchsia-400/40 bg-gradient-to-br from-fuchsia-500/[0.08] to-rose-500/[0.05] shadow-md shadow-fuchsia-500/8'
            : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'"
          @click="selectedModel = 'happyhorse'"
        >
          <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-all"
            :class="selectedModel === 'happyhorse' ? 'bg-fuchsia-500/20' : 'bg-white/[0.05]'">
            <SvgIcon icon="ri:sparkling-2-line" class="text-base"
              :class="selectedModel === 'happyhorse' ? 'text-fuchsia-400' : 'text-white/30'" />
          </div>
          <div class="flex min-w-0 flex-col">
            <span class="truncate whitespace-nowrap text-[11px] font-semibold" :class="selectedModel === 'happyhorse' ? 'text-fuchsia-300' : 'text-white/50'">HappyHorse</span>
            <span class="truncate whitespace-nowrap text-[9px]" :class="selectedModel === 'happyhorse' ? 'text-fuchsia-400/50' : 'text-white/25'">1.0 · 1080p</span>
          </div>
        </button>
      </div>
      <Transition name="hint-fade">
        <p class="text-[11px] text-white/30">{{ modelHints[selectedModel] }}</p>
      </Transition>
    </div>

    <div class="section-divider" />

    <!-- 生成设置 -->
    <div class="flex flex-col gap-3">
      <label class="section-label">生成设置</label>

      <!-- 画面比例 -->
      <div>
        <div class="mb-2 text-[11px] text-white/40 font-medium">画面比例</div>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="opt in resolutionOptions"
            :key="opt.value"
            class="res-btn group flex flex-col items-center gap-2 rounded-xl px-3 py-4"
            :class="{ active: selectedAspectValue === opt.value }"
            @click="selectAspectOption(opt.value)"
          >
            <div class="relative">
              <div
                class="res-icon rounded transition-all duration-200"
                :class="{ active: selectedAspectValue === opt.value }"
                :style="{ width: opt.iconW + 'px', height: opt.iconH + 'px' }"
              />
              <Transition name="hint-fade">
                <SvgIcon v-if="selectedAspectValue === opt.value" icon="ri:check-line" class="absolute -right-1 -top-1 text-[10px] text-sky-400" />
              </Transition>
            </div>
            <div class="text-center">
              <p class="text-xs font-bold" :class="selectedAspectValue === opt.value ? 'text-sky-300' : 'text-white/50'">{{ opt.label }}</p>
              <p class="text-[10px]" :class="selectedAspectValue === opt.value ? 'text-sky-400/60' : 'text-white/25'">{{ opt.desc }}</p>
            </div>
          </button>
        </div>
      </div>

      <!-- 生成模式 (仅可灵) -->
      <div v-if="selectedModel === 'kling'">
        <div class="mb-1 text-[11px] text-white/40 font-medium">生成模式</div>
        <div class="flex gap-2">
          <button
            type="button"
            class="pill-btn"
            :class="{ active: quality === 'standard' }"
            @click="quality = 'standard'"
          >
            标准
          </button>
          <button
            type="button"
            class="pill-btn"
            :class="{ active: quality === 'std' }"
            @click="quality = 'std'"
          >
            Pro
          </button>
        </div>
        <Transition name="hint-fade">
          <p v-if="qualityHints[quality]" class="mt-1 text-[11px] text-white/30">{{ qualityHints[quality] }}</p>
        </Transition>
      </div>


      <!-- 时长 -->
      <div>
        <div class="mb-1 text-[11px] text-white/40 font-medium">时长</div>
        <div class="flex gap-2">
          <button
            v-for="d in [5, 10, 15]"
            :key="d"
            type="button"
            class="pill-btn"
            :class="{ active: duration === d }"
            @click="duration = d"
          >
            {{ d }}s
          </button>
        </div>
        <Transition name="hint-fade">
          <p v-if="durationHints[duration]" class="mt-1 text-[11px] text-white/30">{{ durationHints[duration] }}</p>
        </Transition>
      </div>

      <!-- 输出分辨率 (HappyHorse) -->
      <div v-if="selectedModel === 'happyhorse'">
        <div class="mb-1 text-[11px] text-white/40 font-medium">输出分辨率</div>
        <div class="flex gap-2">
          <button
            v-for="opt in happyHorseResolutionOptions"
            :key="opt.value"
            type="button"
            class="pill-btn"
            :class="{ active: happyHorseResolution === opt.value }"
            @click="happyHorseResolution = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- 提示词关联度 cfgScale (仅可灵) -->
      <div v-if="selectedModel === 'kling'" class="slider-section">
        <div class="mb-1 flex items-center justify-between text-[11px] text-white/40 font-medium">
          <span>提示词关联度</span>
          <span class="font-mono text-[11px] text-sky-400/70">{{ cfgScale.toFixed(2) }}</span>
        </div>
        <NSlider v-model:value="cfgScale" :min="0" :max="1" :step="0.05" :tooltip="false" />
        <Transition name="hint-fade">
          <p class="mt-1 text-[11px] text-white/30">{{ cfgHint }}</p>
        </Transition>
      </div>

      <!-- 声音 -->
      <div v-if="selectedModel !== 'happyhorse'" class="flex items-center justify-between">
        <span class="text-[11px] text-white/40 font-medium">生成声音</span>
        <NSwitch v-model:value="sound" size="small" />
      </div>

      <!-- 积分生成（管理员专用） -->
      <div v-if="isAdmin" class="flex items-center justify-between">
        <span class="text-[11px] font-medium" :class="creditMode ? 'text-amber-400' : 'text-white/40'">
          积分生成
        </span>
        <NSwitch v-model:value="creditMode" size="small" />
      </div>

    </div>

    <div class="section-divider" />

    <!-- 备注 -->
    <div class="flex flex-col gap-1.5">
      <label class="section-label">备注（可选）</label>
      <NInput v-model:value="remark" placeholder="给这个任务加个备注..." class="prompt-textarea" />
    </div>

    <div class="section-divider" />

    <!-- AI自动优化开关 + 提交按钮 -->
    <div class="action-block flex flex-col gap-2">
      <!-- Batch progress bar -->
      <div v-if="batchSubmitting" class="mb-2 rounded-xl border border-violet-400/20 bg-violet-500/[0.05] px-3.5 py-2.5">
        <div class="mb-1.5 flex items-center justify-between text-[11px]">
          <span class="text-violet-300/70">批量提交进度</span>
          <span class="font-mono text-violet-300/90">{{ batchProgress.current }} / {{ batchProgress.total }}</span>
        </div>
        <div class="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div class="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-300"
            :style="{ width: Math.round(batchProgress.current / batchProgress.total * 100) + '%' }" />
        </div>
        <div class="mt-1 flex items-center gap-3 text-[10px]">
          <span class="text-emerald-400/60">成功 {{ batchProgress.success }}</span>
          <span v-if="batchProgress.fail > 0" class="text-red-400/60">失败 {{ batchProgress.fail }}</span>
        </div>
      </div>
      <div class="action-progress">
        <div class="progress-meta">
          <span class="text-[10px] text-white/30">提交准备度</span>
          <span class="text-[10px] font-mono text-white/40">{{ completionRatio }}%</span>
        </div>
        <div class="progress-rail">
          <div class="progress-fill" :style="{ width: completionRatio + '%' }" />
        </div>
        <div class="requirement-row">
          <span
            v-for="item in completionItems"
            :key="item.key"
            class="requirement-chip"
            :class="{ done: item.done }"
          >
            <SvgIcon :icon="item.done ? 'ri:checkbox-circle-line' : 'ri:time-line'" class="text-[10px]" />
            {{ item.label }}
          </span>
        </div>
      </div>

      <div class="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 transition-all duration-200" :class="aiAutoOptimize ? 'border-sky-400/20 bg-sky-500/[0.05]' : ''">
        <div class="flex items-center gap-2">
          <div class="flex h-5 w-5 items-center justify-center rounded-md" :class="aiAutoOptimize ? 'bg-sky-500/15' : 'bg-white/[0.05]'">
            <SvgIcon icon="ri:magic-line" class="text-xs" :class="aiAutoOptimize ? 'text-sky-400' : 'text-white/30'" />
          </div>
          <span class="text-[11px] font-medium" :class="aiAutoOptimize ? 'text-sky-300/70' : 'text-white/40'">提交时AI优化提示词</span>
        </div>
        <NSwitch v-model:value="aiAutoOptimize" size="small" />
      </div>
      <button
        type="button"
        class="submit-btn"
        :class="{ 'can-submit': canSubmit, 'is-submitting': loading }"
        :disabled="!canSubmit"
        :title="canSubmit ? `快捷提交：${submitShortcutLabel}` : canSubmitReason"
        @click="batchMode && uploadedUrls.length > 1 ? batchSubmit() : handleSubmitWithAi()"
      >
        <template v-if="loading">
          <div class="submit-spinner" />
          提交中...
        </template>
        <template v-else-if="submitSuccess">
          <SvgIcon icon="ri:check-line" class="text-base text-emerald-300" />
          <span class="text-emerald-300">已提交</span>
        </template>
        <template v-else-if="batchSubmitting">
          <div class="submit-spinner" />
          批量提交中 {{ batchProgress.current }}/{{ batchProgress.total }}
        </template>
        <template v-else>
          <SvgIcon icon="ri:play-circle-line" class="text-base" />
          {{ batchMode && uploadedUrls.length > 1 ? `批量生成 (${uploadedUrls.length} 个任务)` : '生成视频' }}
        </template>
      </button>
      <p v-if="canSubmit" class="text-center text-[10px] text-sky-300/55">按 {{ submitShortcutLabel }} 可快速提交</p>
      <p v-else-if="canSubmitReason" class="text-center text-[11px] text-amber-300/75">{{ canSubmitReason }}</p>
    </div>
  </div>


  <!-- AI Prompt Optimization Drawer -->
  <NDrawer v-model:show="showAiOptimize" placement="right" :width="400" :mask-style="{ backdropFilter: 'blur(8px)', background: 'rgba(0,0,0,0.6)' }">
    <NDrawerContent closable class="ai-opt-drawer">
      <template #header>
        <div class="flex items-center justify-between w-full pr-2">
          <div class="flex items-center gap-2.5">
            <div class="ai-drawer-icon flex h-8 w-8 items-center justify-center rounded-lg">
              <SvgIcon icon="ri:magic-line" class="text-base text-sky-300" />
            </div>
            <div class="flex flex-col">
              <span class="text-[13px] font-bold text-white/90 tracking-wide">AI 提示词优化</span>
              <span class="text-[10px] text-white/30">智能生成最优提示词</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              v-if="aiMessages.length > 0"
              class="flex items-center gap-1 rounded-lg border border-white/8 bg-white/3 px-2 py-1 text-[10px] text-white/30 transition-all hover:border-red-400/20 hover:bg-red-500/8 hover:text-red-300/70 active:scale-95"
              title="清空对话记忆，重新开始"
              @click="clearAiSession"
            >
              <SvgIcon icon="ri:delete-bin-line" class="text-xs" />
              清空
            </button>
            <div class="ai-model-badge flex items-center gap-1.5 rounded-lg border border-sky-400/25 bg-sky-500/10 px-2.5 py-1">
              <SvgIcon icon="ri:robot-2-line" class="text-xs text-sky-400/70" />
              <span class="text-[11px] font-bold text-sky-300/90 tracking-wide">GPT-5.4</span>
            </div>
          </div>
        </div>
      </template>

      <div ref="aiDrawerBodyEl" class="ai-drawer-body">
        <!-- Image preview - compact inline -->
        <div v-if="images.length > 0" class="mb-4 flex items-center gap-2.5">
          <div class="flex -space-x-2">
            <div v-for="img in images" :key="img.id" class="h-10 w-10 overflow-hidden rounded-lg border-2 border-[#0a0e19] shadow-lg">
              <img v-if="img.preview" :src="img.preview" class="h-full w-full object-cover" />
            </div>
          </div>
          <span class="text-[11px] text-white/30">{{ images.length }} 张参考图片</span>
        </div>
        <div v-else class="mb-4 flex items-center gap-2.5 rounded-lg border border-amber-400/10 bg-amber-500/[0.04] px-3 py-2.5">
          <SvgIcon icon="ri:image-add-line" class="text-sm text-amber-400/50" />
          <span class="text-[11px] text-amber-300/60">请先上传参考图片</span>
        </div>

        <!-- Skills - collapsible -->
        <div class="mb-4">
          <button
            class="mb-2 flex w-full items-center gap-1.5 text-left"
            @click="skillsExpanded = !skillsExpanded"
          >
            <SvgIcon icon="ri:apps-2-line" class="text-xs text-sky-400/50" />
            <p class="text-[11px] font-semibold text-white/40">场景技能</p>
            <span v-if="selectedSkill && !skillsExpanded" class="ml-1 rounded-md border border-sky-400/25 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300">
              {{ AI_SKILLS.find(s => s.id === selectedSkill)?.label }}
            </span>
            <SvgIcon
              icon="ri:arrow-down-s-line"
              class="ml-auto text-sm text-white/25 transition-transform duration-200"
              :class="{ 'rotate-180': skillsExpanded }"
            />
          </button>

          <!-- Collapsed: show 动作优化 as main button + expand hint -->
          <div v-if="!skillsExpanded" class="space-y-2">
            <button
              class="flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all duration-200 active:scale-[0.97]"
              :class="selectedSkill === 'action' ? 'border-sky-400/40 bg-sky-500/10' : 'border-sky-400/15 bg-sky-500/[0.04] hover:border-sky-400/25 hover:bg-sky-500/[0.08]'"
              @click="selectSkill('action')"
            >
              <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg" :class="selectedSkill === 'action' ? 'bg-sky-500/30' : 'bg-sky-500/15'">
                <SvgIcon icon="ri:body-scan-line" class="text-sm text-sky-400" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-[12px] font-semibold" :class="selectedSkill === 'action' ? 'text-sky-200' : 'text-white/70'">动作优化</p>
                <p class="text-[10px]" :class="selectedSkill === 'action' ? 'text-sky-400/50' : 'text-white/30'">优化人物动作，更好展示商品，聚焦商品</p>
              </div>
              <SvgIcon v-if="selectedSkill === 'action'" icon="ri:check-line" class="text-sm text-sky-400" />
            </button>
            <div class="flex items-center gap-2">
              <button
                class="flex-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-medium transition-all active:scale-95"
                :class="selectedSkill === 'camera' ? 'border-sky-400/60 bg-sky-500/25 text-sky-200' : 'border-white/[0.12] bg-white/[0.05] text-white/50 hover:border-white/20 hover:text-white/70'"
                @click="selectSkill('camera')"
              >
                <SvgIcon icon="ri:camera-lens-line" class="mr-1 inline text-xs" />镜头优化
              </button>
              <button
                class="flex-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-medium transition-all active:scale-95"
                :class="selectedSkill === 'product' ? 'border-sky-400/60 bg-sky-500/25 text-sky-200' : 'border-white/[0.12] bg-white/[0.05] text-white/50 hover:border-white/20 hover:text-white/70'"
                @click="selectSkill('product')"
              >
                <SvgIcon icon="ri:shopping-bag-3-line" class="mr-1 inline text-xs" />产品特写
              </button>
              <button
                class="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-white/25 transition-all hover:border-white/12 hover:text-white/40"
                @click="skillsExpanded = true"
              >
                更多
              </button>
            </div>
          </div>

          <!-- Expanded: grouped skill cards -->
          <Transition name="hint-fade">
            <div v-if="skillsExpanded" class="space-y-3">
              <div v-for="group in ['常用', '动作', '达人', '创意', '场景', '风格']" :key="group">
                <p class="mb-1.5 text-[10px] font-medium text-white/20">{{ group }}</p>
                <div class="grid grid-cols-2 gap-1.5">
                  <button
                    v-for="skill in AI_SKILLS.filter(s => s.group === group)"
                    :key="skill.id"
                    class="ai-skill-card group flex items-start gap-2 rounded-xl border p-2 text-left transition-all duration-200 active:scale-[0.97]"
                    :class="selectedSkill === skill.id ? 'border-sky-400/60 bg-sky-500/20 shadow-sm shadow-sky-500/10' : 'border-white/[0.10] bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.08]'"
                    @click="selectSkill(skill.id)"
                  >
                    <div class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg transition-colors duration-200"
                      :class="selectedSkill === skill.id ? 'bg-sky-500/30' : 'bg-white/[0.06] group-hover:bg-white/[0.12]'"
                    >
                      <SvgIcon :icon="skill.icon" class="text-xs" :class="selectedSkill === skill.id ? 'text-sky-300' : 'text-white/40 group-hover:text-white/60'" />
                    </div>
                    <div class="min-w-0">
                      <p class="text-[11px] font-semibold" :class="selectedSkill === skill.id ? 'text-sky-200 drop-shadow-sm' : 'text-white/65'">{{ skill.label }}</p>
                      <p class="text-[10px] leading-snug" :class="selectedSkill === skill.id ? 'text-sky-300/60' : 'text-white/35'">{{ skill.desc }}</p>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </Transition>
        </div>

        <!-- Optimization direction input -->
        <div class="mb-4">
          <div class="mb-2 flex items-center gap-1.5">
            <SvgIcon icon="ri:edit-2-line" class="text-xs text-sky-400/50" />
            <p class="text-[11px] font-semibold text-white/40">优化方向</p>
            <span class="ml-auto text-[10px] text-white/20">可修改或补充</span>
          </div>
          <NInput
            v-model:value="aiExtraRequest"
            type="textarea"
            placeholder="选择上方技能自动填充，或手动输入：&#10;· 镜头聚焦到裤子&#10;· 加入走路动作&#10;· 突出质感"
            :autosize="{ minRows: 2, maxRows: 4 }"
            class="prompt-textarea"
          />
        </div>



        <!-- Generate button - always visible -->
        <button
          class="ai-generate-btn group w-full rounded-xl border border-sky-400/20 px-4 py-3 text-[13px] font-semibold transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-30"
          :class="aiGenerating ? 'bg-sky-500/10 text-sky-300/80' : 'bg-gradient-to-r from-sky-500/15 via-blue-500/15 to-cyan-500/10 text-sky-300 hover:from-sky-500/25 hover:via-blue-500/25 hover:to-cyan-500/15 hover:border-sky-400/35 hover:shadow-lg hover:shadow-sky-500/10'"
          :disabled="aiGenerating || images.length === 0"
          @click="generateAiPrompt"
        >
          <template v-if="aiGenerating">
            <div class="flex items-center justify-center gap-2">
              <div class="ai-gen-spinner" />
              <span>AI 正在分析图片并生成提示词...</span>
            </div>
          </template>
          <template v-else>
            <div class="flex items-center justify-center gap-1.5">
              <SvgIcon icon="ri:sparkling-2-line" class="text-sm transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
              <span>{{ aiResult ? '重新生成' : '生成优化提示词' }}</span>
            </div>
          </template>
        </button>

        <!-- Chat area: thinking + messages + streaming -->
        <div ref="aiChatScrollEl" class="ai-chat-area mt-4 space-y-3 pr-1">
          <!-- Previous conversation messages -->
          <template v-for="(msg, idx) in aiMessages" :key="idx">
            <!-- User follow-up bubble -->
            <div v-if="msg.role === 'user'" class="flex justify-end">
              <div class="ai-chat-user rounded-xl rounded-tr-sm border border-sky-400/15 bg-sky-500/10 px-3 py-2 max-w-[85%]">
                <p class="text-[12px] leading-relaxed text-sky-200/90">{{ msg.content }}</p>
              </div>
            </div>
            <!-- AI response bubble (only show completed ones, not the last if still streaming) -->
            <div v-else-if="msg.role === 'assistant' && !(aiGenerating && idx === aiMessages.length - 1)" class="flex justify-start">
              <div class="ai-chat-bot rounded-xl rounded-tl-sm border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 max-w-[90%]">
                <p class="whitespace-pre-wrap text-[13px] leading-[1.8] text-white/85" v-html="highlightKeywords(msg.content)"></p>
              </div>
            </div>
          </template>

          <!-- Thinking indicator -->
          <div v-if="aiThinking" class="flex justify-start">
            <div class="ai-chat-bot rounded-xl rounded-tl-sm border border-white/[0.06] bg-white/[0.03] px-4 py-3">
              <div class="ai-thinking-dots flex items-center gap-1">
                <span class="text-[11px] text-white/40 mr-1.5">思考中</span>
                <span class="ai-dot" /><span class="ai-dot" /><span class="ai-dot" />
              </div>
            </div>
          </div>

          <!-- Current streaming result -->
          <div v-if="aiStreamText && !aiThinking && aiGenerating" class="flex justify-start">
            <div class="ai-chat-bot rounded-xl rounded-tl-sm border border-sky-400/15 bg-white/[0.03] px-3.5 py-2.5 max-w-[90%]">
              <p class="whitespace-pre-wrap text-[13px] leading-[1.8] text-white/85"><span v-html="highlightKeywords(aiStreamText)"></span><span v-if="aiGenerating" class="ai-cursor ml-0.5 inline-block h-4 w-[2px] rounded-full bg-sky-400" /></p>
            </div>
          </div>
        </div>

        <!-- Compare panel: original vs AI optimized -->
        <div v-if="(aiStreamText || aiResult) && !aiGenerating && aiOriginalPrompt" class="mt-4">
          <div class="rounded-xl border border-white/[0.08] overflow-hidden">
            <!-- Original -->
            <div class="px-3.5 py-2.5 bg-white/[0.02] border-b border-white/[0.06]">
              <div class="flex items-center gap-1.5 mb-1.5">
                <div class="h-1.5 w-1.5 rounded-full bg-white/20"></div>
                <span class="text-[10px] font-semibold text-white/30 tracking-wide uppercase">原始提示词</span>
              </div>
              <p class="text-[12px] leading-[1.7] text-white/30 line-through decoration-white/15">{{ aiOriginalPrompt }}</p>
            </div>
            <!-- Arrow divider -->
            <div class="flex items-center justify-center py-1 bg-white/[0.01]">
              <SvgIcon icon="ri:arrow-down-line" class="text-sm text-sky-400/40" />
            </div>
            <!-- AI Optimized -->
            <div class="px-3.5 py-2.5 bg-sky-500/[0.04] border-t border-sky-400/10">
              <div class="flex items-center gap-1.5 mb-1.5">
                <div class="h-1.5 w-1.5 rounded-full bg-sky-400/60"></div>
                <span class="text-[10px] font-semibold text-sky-300/50 tracking-wide uppercase">AI 优化</span>
                <SvgIcon icon="ri:sparkling-2-line" class="text-[10px] text-sky-400/40" />
              </div>
              <p class="text-[12px] leading-[1.7] text-white/80" v-html="highlightKeywords(aiResult || aiStreamText)"></p>
            </div>
          </div>
        </div>

        <!-- AI result without original (no comparison needed) -->
        <div v-else-if="(aiStreamText || aiResult) && !aiGenerating && !aiOriginalPrompt" class="mt-4">
          <div class="rounded-xl border border-sky-400/15 bg-sky-500/[0.04] px-3.5 py-2.5">
            <div class="flex items-center gap-1.5 mb-1.5">
              <div class="h-1.5 w-1.5 rounded-full bg-sky-400/60"></div>
              <span class="text-[10px] font-semibold text-sky-300/50 tracking-wide uppercase">AI 生成</span>
            </div>
            <p class="text-[12px] leading-[1.7] text-white/80" v-html="highlightKeywords(aiResult || aiStreamText)"></p>
          </div>
        </div>

        <!-- Action buttons after generation completes -->
        <div v-if="(aiStreamText || aiResult) && !aiGenerating" class="mt-3 space-y-3">
          <div class="flex gap-2.5">
            <button
              v-if="aiPendingSubmit"
              class="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-sky-400/30 bg-gradient-to-r from-sky-500/20 to-blue-500/20 px-4 py-2.5 text-xs font-semibold text-sky-300 transition-all duration-200 hover:from-sky-500/30 hover:to-blue-500/30 hover:shadow-lg hover:shadow-sky-500/10 active:scale-[0.98]"
              @click="applyAiResult(true)"
            >
              <SvgIcon icon="ri:check-line" class="text-sm" />
              采用并提交
            </button>
            <button
              class="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-medium text-white/60 transition-all duration-200 hover:border-white/15 hover:bg-white/[0.08] hover:text-white/80 active:scale-[0.98]"
              @click="applyAiResult(false)"
            >
              <SvgIcon icon="ri:arrow-left-line" class="text-sm" />
              仅采用
            </button>
          </div>

          <!-- Follow-up input for multi-turn -->
          <div class="ai-followup-area rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5">
            <p class="mb-2 text-[11px] text-white/30">💬 你还想怎么优化？可以继续对话调整</p>
            <div class="flex gap-2">
              <NInput
                v-model:value="aiFollowUp"
                type="text"
                placeholder="如：镜头再推近一点 / 加入转身动作..."
                size="small"
                class="prompt-textarea flex-1"
                @keyup.enter="generateAiFollowUp"
              />
              <button
                class="shrink-0 rounded-lg border border-sky-400/25 bg-sky-500/10 px-3 py-1.5 text-[11px] font-semibold text-sky-300 transition-all hover:bg-sky-500/20 active:scale-95 disabled:opacity-30"
                :disabled="!aiFollowUp.trim() || aiGenerating"
                @click="generateAiFollowUp"
              >
                <SvgIcon icon="ri:send-plane-2-line" class="text-xs" />
              </button>
            </div>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <button
                v-for="hint in dynamicHints"
                :key="hint"
                class="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-[10px] text-white/30 transition-all hover:border-sky-400/20 hover:bg-sky-500/[0.06] hover:text-sky-300/70"
                @click="aiFollowUp = hint; generateAiFollowUp()"
              >
                {{ hint }}
              </button>
            </div>
          </div>
        </div>

        <!-- Error -->
        <div v-if="aiError" class="mt-4 flex items-center gap-2.5 rounded-xl border border-red-400/15 bg-red-500/[0.06] p-3">
          <SvgIcon icon="ri:error-warning-line" class="flex-shrink-0 text-base text-red-400/60" />
          <p class="text-xs leading-relaxed text-red-300/80">{{ aiError }}</p>
        </div>
      </div>
    </NDrawerContent>
  </NDrawer>

</template>

<style scoped>
/* ── Glass panel container ── */
.mvp-panel {
  position: relative;
  background:
    linear-gradient(135deg, rgba(56, 189, 248, 0.04) 0%, rgba(59, 130, 246, 0.03) 50%, rgba(255, 255, 255, 0.02) 100%),
    rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(16px);
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  border-image: linear-gradient(to bottom, rgba(56, 189, 248, 0.15), rgba(255, 255, 255, 0.06)) 1;
}
.mvp-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: block;
  height: 1px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(56, 189, 248, 0.05), rgba(56, 189, 248, 0.55), rgba(56, 189, 248, 0.05));
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}
.mvp-panel.panel-ready::before {
  opacity: 1;
}

/* ── Panel entrance ── */
.mvp-panel {
  animation: panelFadeIn 0.35s ease-out;
}
@keyframes panelFadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Thin dark scrollbar (4px) ── */
.mvp-panel::-webkit-scrollbar {
  width: 4px;
}
.mvp-panel::-webkit-scrollbar-track {
  background: transparent;
}
.mvp-panel::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}
.mvp-panel::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.18);
}

/* ── Section dividers ── */
.section-divider {
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(255, 255, 255, 0.08), transparent);
  margin: 4px 0;
}

/* ── Section label ── */
.section-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.50);
  letter-spacing: 0.02em;
}

button:focus-visible,
.upload-trigger:focus-within {
  outline: 2px solid rgba(56, 189, 248, 0.65);
  outline-offset: 2px;
}

/* ── Header icon with gradient ── */
.header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.25), rgba(59, 130, 246, 0.2));
  color: rgba(255, 255, 255, 0.9);
}

/* ── User info chip ── */
.user-chip {
  padding: 12px 16px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  transition: all 0.3s ease;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  flex-shrink: 0;
  transition: all 0.3s;
}
.status-dot.dot-active {
  background: rgba(52, 211, 153, 0.8);
  box-shadow: 0 0 6px rgba(52, 211, 153, 0.4);
}

/* ── Textarea ── */
.textarea-wrapper {
  position: relative;
}

.ghost-action-btn {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
  color: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  line-height: 1;
  padding: 5px 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ghost-action-btn:hover:not(:disabled) {
  color: rgba(255, 255, 255, 0.85);
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.ghost-action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.prompt-textarea :deep(.n-input__textarea-el),
.prompt-textarea :deep(.n-input__input-el) {
  font-size: 13px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.85) !important;
}

.prompt-textarea :deep(.n-input) {
  --n-border: 1px solid rgba(255, 255, 255, 0.08) !important;
  --n-border-hover: 1px solid rgba(56, 189, 248, 0.3) !important;
  --n-border-focus: 1px solid rgba(56, 189, 248, 0.5) !important;
  --n-color: rgba(255, 255, 255, 0.03) !important;
  --n-color-focus: rgba(255, 255, 255, 0.05) !important;
  --n-box-shadow-focus: 0 0 0 2px rgba(56, 189, 248, 0.1) !important;
}

/* ── Pill buttons ── */
.pill-btn {
  flex: 1;
  padding: 12px 0;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.65);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  cursor: pointer;
  letter-spacing: 0.03em;
}

.pill-btn:hover {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.07));
  color: rgba(255, 255, 255, 0.92);
  border-color: rgba(255, 255, 255, 0.22);
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.pill-btn.active {
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.35), rgba(59, 130, 246, 0.25));
  border-color: rgba(56, 189, 248, 0.55);
  color: #fff;
  box-shadow: 0 0 20px rgba(56, 189, 248, 0.2), 0 4px 12px rgba(56, 189, 248, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
.pill-btn:active {
  transform: scale(0.97);
}

/* ── Resolution buttons ── */
.res-btn {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.res-btn:hover {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.06));
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-2px) scale(1.03);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.res-btn:active {
  transform: scale(0.96);
}
.res-btn.active {
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.3), rgba(59, 130, 246, 0.2));
  border-color: rgba(56, 189, 248, 0.55);
  box-shadow: 0 0 24px rgba(56, 189, 248, 0.2), 0 4px 12px rgba(56, 189, 248, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.res-icon {
  border: 2px solid rgba(255, 255, 255, 0.15);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
  transition: all 0.2s;
}

.res-icon.active {
  border-color: rgba(56, 189, 248, 0.65);
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.25), rgba(59, 130, 246, 0.2));
}

/* ── Upload area (images & video) ── */
.upload-area {
  border: 1.5px dashed rgba(255, 255, 255, 0.10);
  background: rgba(255, 255, 255, 0.02);
  transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.upload-area:hover {
  border-color: rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.06);
  transform: scale(1.01);
  box-shadow: 0 0 16px rgba(56, 189, 248, 0.08);
}
.img-drop-zone.is-uploading {
  animation: border-dance 1.8s linear infinite;
}

@keyframes border-dance {
  0% { border-color: rgba(56, 189, 248, 0.35); }
  50% { border-color: rgba(59, 130, 246, 0.45); }
  100% { border-color: rgba(56, 189, 248, 0.35); }
}

/* ── Slider section ── */
.slider-section :deep(.n-slider) {
  --n-rail-color: rgba(255, 255, 255, 0.08);
  --n-rail-color-hover: rgba(255, 255, 255, 0.12);
  --n-fill-color: rgba(56, 189, 248, 0.5);
  --n-fill-color-hover: rgba(56, 189, 248, 0.65);
}
.slider-section :deep(.n-slider-handle) {
  --n-handle-color: rgba(56, 189, 248, 0.85) !important;
  --n-handle-box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.25) !important;
  --n-handle-box-shadow-hover: 0 0 0 3px rgba(56, 189, 248, 0.35) !important;
  --n-handle-box-shadow-active: 0 0 0 3px rgba(56, 189, 248, 0.45) !important;
  --n-handle-box-shadow-focus: 0 0 0 3px rgba(56, 189, 248, 0.35) !important;
}

/* ── Submit button ── */
.submit-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 15px 0;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.4);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  cursor: not-allowed;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  letter-spacing: 0.03em;
}

.action-block {
  position: sticky;
  bottom: -10px;
  z-index: 2;
  margin: 0 -4px;
  padding: 8px 4px 2px;
  background: linear-gradient(180deg, rgba(8, 10, 18, 0), rgba(8, 10, 18, 0.5) 24%, rgba(8, 10, 18, 0.78));
  backdrop-filter: blur(8px);
}

.action-progress {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 10px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01));
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.progress-rail {
  width: 100%;
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(56, 189, 248, 0.45), rgba(56, 189, 248, 0.95));
  transition: width 0.25s ease;
}

.requirement-row {
  margin-top: 8px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.requirement-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  transition: all 0.2s ease;
}

.requirement-chip.done {
  color: rgba(103, 232, 249, 0.95);
  border-color: rgba(56, 189, 248, 0.4);
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.2), rgba(56, 189, 248, 0.1));
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.1);
}

.submit-btn.can-submit {
  cursor: pointer;
  color: #fff;
  background: linear-gradient(180deg, rgba(14, 165, 233, 0.95), rgba(37, 99, 235, 0.9));
  border-color: rgba(56, 189, 248, 0.5);
  box-shadow:
    0 4px 16px rgba(14, 165, 233, 0.35),
    0 0 0 1px rgba(56, 189, 248, 0.15) inset,
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
  animation: subtle-pulse 2.5s ease-in-out infinite;
}

.submit-btn.can-submit:hover {
  background: linear-gradient(180deg, rgba(56, 189, 248, 1), rgba(59, 130, 246, 0.98));
  box-shadow:
    0 8px 28px rgba(14, 165, 233, 0.45),
    0 0 0 1px rgba(255, 255, 255, 0.1) inset,
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  transform: translateY(-2px) scale(1.01);
}

.submit-btn.can-submit:active {
  transform: translateY(0);
  box-shadow: 0 1px 6px rgba(14, 165, 233, 0.2);
}

.submit-btn.submit-success {
  cursor: default;
  color: rgba(110, 231, 183, 0.95);
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(52, 211, 153, 0.25));
  border-color: rgba(52, 211, 153, 0.4);
  box-shadow: 0 2px 12px rgba(52, 211, 153, 0.2);
  animation: submitSuccessFlash 0.6s ease-out;
}

@keyframes submitSuccessFlash {
  0% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.5); }
  50% { box-shadow: 0 0 20px 4px rgba(52, 211, 153, 0.3); }
  100% { box-shadow: 0 2px 12px rgba(52, 211, 153, 0.2); }
}

.submit-btn.is-submitting {
  cursor: wait;
  animation: none;
}

@keyframes subtle-pulse {
  0%, 100% {
    box-shadow:
      0 2px 12px rgba(14, 165, 233, 0.25),
      0 0 0 1px rgba(56, 189, 248, 0.1) inset;
  }
  50% {
    box-shadow:
      0 2px 20px rgba(14, 165, 233, 0.4),
      0 0 0 1px rgba(56, 189, 248, 0.2) inset;
  }
}

/* ── Submit spinner ── */
.submit-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Hint transitions ── */
.hint-fade-enter-active,
.hint-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.hint-fade-enter-from,
.hint-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* Upload success flash */
@keyframes uploadFlash {
  0% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.4); }
  50% { box-shadow: 0 0 12px 2px rgba(52, 211, 153, 0.3); }
  100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); }
}

/* AI Optimization Drawer */
.ai-opt-drawer :deep(.n-drawer-body-content-wrapper) {
  background: linear-gradient(180deg, rgba(8, 10, 18, 0.99) 0%, rgba(10, 14, 25, 0.99) 100%) !important;
}

.ai-opt-drawer :deep(.n-drawer-header) {
  background: rgba(255, 255, 255, 0.02) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
  padding: 16px 20px !important;
}

.ai-opt-drawer :deep(.n-drawer-body) {
  padding: 0 !important;
}

.ai-opt-drawer :deep(.n-drawer-body-content-wrapper) {
  overflow-y: auto !important;
  height: 100% !important;
}

.ai-drawer-body {
  padding: 20px;
  overflow-y: auto;
}

.ai-drawer-icon {
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(59, 130, 246, 0.15));
  border: 1px solid rgba(56, 189, 248, 0.15);
}

.ai-opt-btn {
  backdrop-filter: blur(6px);
}

.ai-skill-card {
  cursor: pointer;
}

.ai-skill-card:hover {
  transform: translateY(-1px);
}

.ai-img-thumb {
  transition: all 0.2s ease;
}

.ai-img-thumb:hover {
  border-color: rgba(56, 189, 248, 0.3);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.ai-result-card {
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.04), rgba(59, 130, 246, 0.03));
  backdrop-filter: blur(8px);
  position: relative;
}

.ai-result-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(56, 189, 248, 0.3), transparent);
}

.ai-generate-btn {
  position: relative;
  overflow: hidden;
}

.ai-generate-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.06), transparent);
  transition: left 0.5s ease;
}

.ai-generate-btn:not(:disabled):hover::before {
  left: 100%;
}

.ai-gen-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(56, 189, 248, 0.2);
  border-top-color: rgba(56, 189, 248, 0.8);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.ai-cursor {
  animation: cursorBlink 0.8s step-end infinite;
}

/* Thinking dots animation */
.ai-thinking-dots .ai-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(56, 189, 248, 0.5);
  animation: ai-thinking-bounce 1.4s ease-in-out infinite;
}
.ai-thinking-dots .ai-dot:nth-child(2) { animation-delay: 0.16s; }
.ai-thinking-dots .ai-dot:nth-child(3) { animation-delay: 0.32s; }
.ai-thinking-dots .ai-dot:nth-child(4) { animation-delay: 0.48s; }

@keyframes ai-thinking-bounce {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1.1); }
}

.ai-chat-area::-webkit-scrollbar { width: 3px; }
.ai-chat-area::-webkit-scrollbar-track { background: transparent; }
.ai-chat-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }

.ai-chat-user, .ai-chat-bot {
  animation: ai-chat-in 0.3s ease-out;
}
@keyframes ai-chat-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.ai-followup-area {
  animation: ai-chat-in 0.4s ease-out;
}

@keyframes cursorBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}

/* Submit success animation bar */
.success-bar {
  position: relative;
  border-radius: 8px;
  padding: 10px 14px;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(52, 211, 153, 0.18));
  border: 1px solid rgba(52, 211, 153, 0.3);
  color: rgba(167, 243, 208, 0.95);
  font-size: 13px;
  overflow: hidden;
}
.success-bar-content {
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
  z-index: 1;
}
.success-bar-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  background: linear-gradient(90deg, rgba(52, 211, 153, 0.6), rgba(16, 185, 129, 0.3));
  animation: success-bar-fill 3s linear forwards;
}
@keyframes success-bar-fill {
  from { width: 0%; }
  to { width: 100%; }
}
.success-bar-enter-active {
  transition: all 0.4s ease-out;
}
.success-bar-leave-active {
  transition: all 0.5s ease-in;
}
.success-bar-enter-from {
  opacity: 0;
  transform: translateY(-12px);
}
.success-bar-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}


.today-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.12), rgba(251, 146, 60, 0.08));
  border: 1px solid rgba(251, 191, 36, 0.25);
  box-shadow: 0 0 12px rgba(251, 191, 36, 0.08);
}

.system-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.12), rgba(14, 165, 233, 0.08));
  border: 1px solid rgba(56, 189, 248, 0.25);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.08);
}
</style>
