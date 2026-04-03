<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { NAlert, NButton, NInput, NSpin, NSwitch, NTag, NSlider, NTooltip, useMessage } from 'naive-ui'
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

const message = useMessage()
const { headers: authHeaders, token: jwtToken, username: jwtUsername, role: jwtRole } = useRunwayJwt()

const loading = ref(false)
const prompt = ref('')
const remark = ref('')
const images = ref<UploadedImage[]>([])
const exploreMode = ref(true)
const duration = ref(5)
const resolution = ref('720x1280')
const quality = ref('std')
const sound = ref(true)
const cfgScale = ref(0.5)

// Pro mode: reference video
const refVideo = ref<{ preview: string; url: string; uploading: boolean } | null>(null)

const stdResolutions = [
  { value: '720x1280', label: '9:16', desc: '竖屏 720p', iconW: 20, iconH: 34 },
  { value: '1280x720', label: '16:9', desc: '横屏 720p', iconW: 34, iconH: 20 },
  { value: '960x960', label: '1:1', desc: '方形 960p', iconW: 26, iconH: 26 },
]
const proResolutions = [
  { value: '1080x1920', label: '9:16', desc: '竖屏 1080p', iconW: 20, iconH: 34 },
  { value: '1920x1080', label: '16:9', desc: '横屏 1080p', iconW: 34, iconH: 20 },
  { value: '1440x1440', label: '1:1', desc: '方形 1440p', iconW: 26, iconH: 26 },
]
const resolutionOptions = computed(() => quality.value === 'pro' ? proResolutions : stdResolutions)

const stdToProMap: Record<string, string> = { '720x1280': '1080x1920', '1280x720': '1920x1080', '960x960': '1440x1440' }
const proToStdMap: Record<string, string> = { '1080x1920': '720x1280', '1920x1080': '1280x720', '1440x1440': '960x960' }
watch(quality, (newQ) => {
  if (newQ === 'pro') {
    resolution.value = stdToProMap[resolution.value] || '1080x1920'
  } else {
    resolution.value = proToStdMap[resolution.value] || '720x1280'
  }
})

const durationHints: Record<number, string> = {
  5: '适合产品展示、短镜头动作，生成速度最快',
  10: '适合完整动作展示、多步骤演示，推荐日常使用',
  15: '适合复杂场景、长镜头叙事，生成时间较长',
}



const qualityHints: Record<string, string> = {
  std: '标准模式 — 基于参考图片生成视频，适合大多数场景，消耗 1 个配额',
  pro: '专业模式 — 支持参考视频+图片混合输入，运动控制更精准，画质更高，消耗 2 个配额',
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

const isUploading = computed(() => images.value.some((item) => item.uploading))
const uploadedUrls = computed(() => images.value.filter((item) => item.url).map((item) => item.url))
const remainingSlots = computed(() => Math.max(0, MAX_IMAGES - images.value.length))

const isVideoUploading = computed(() => refVideo.value?.uploading === true)

const canSubmit = computed(() => {
  if (!jwtToken.value) return false
  if (!prompt.value.trim()) return false
  if (uploadedUrls.value.length === 0) return false
  if (quality.value === 'pro' && (!refVideo.value || !refVideo.value.url)) return false
  if (loading.value || isUploading.value || isVideoUploading.value) return false
  return true
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

const createUid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

const updateImage = (id: string, patch: Partial<UploadedImage>) => {
  const index = images.value.findIndex((item) => item.id === id)
  if (index < 0) return
  images.value[index] = { ...images.value[index], ...patch }
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
    return
  }

  try {
    const res = await fetch('/api/runway/token-status', { headers: authHeaders() })
    if (!res.ok) return

    const data = await res.json()
    activeTasks.value = data.activeTasks ?? 0
    maxConcurrency.value = data.maxConcurrency ?? 2
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
      // Check image dimensions
      const img = new Image()
      img.src = base64
      img.onload = () => {
        if (img.width < 300 || img.height < 300) {
          message.error(`图片 ${file.name} 尺寸太小(${img.width}x${img.height})，Runway要求至少300x300px`, { duration: 6000 })
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
  input.value = ''
}

const removeImage = (index: number) => {
  images.value.splice(index, 1)
}

const handleVideoSelect = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  refVideo.value = { preview: '', url: '', uploading: true }
  const reader = new FileReader()
  reader.onload = async (readerEvent) => {
    const base64 = String(readerEvent.target?.result || '')
    if (!base64) { refVideo.value = null; message.error('视频读取失败'); return }
    if (refVideo.value) refVideo.value.preview = base64
    try {
      const uploadRes = await fetch('/api/runway/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ data: base64, filename: file.name }),
      })
      if (!uploadRes.ok) throw new Error('上传失败')
      const uploadData = await uploadRes.json()
      if (refVideo.value) { refVideo.value.url = uploadData.url; refVideo.value.uploading = false }
    } catch (error: any) {
      refVideo.value = null
      message.error(`视频上传失败：${error.message || file.name}`)
    }
  }
  reader.readAsDataURL(file)
  input.value = ''
}

const removeVideo = () => { refVideo.value = null }

const submit = async () => {
  if (!canSubmit.value) return
  loading.value = true
  try {
    const payload = {
      prompt: prompt.value.trim(),
      mode: 'image_to_video',
      exploreMode: exploreMode.value,
      duration: duration.value,
      resolution: resolution.value || undefined,
      quality: quality.value,
      cfgScale: cfgScale.value,
      sound: sound.value,
      remark: remark.value.trim() || undefined,
      imageUrls: uploadedUrls.value,
      videoUrl: (quality.value === 'pro' && refVideo.value?.url) ? refVideo.value.url : undefined,
    }
    const res = await fetch('/api/runway/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`任务提交失败（${res.status}）`)
    message.success('任务已提交，正在排队处理')
    prompt.value = ''
    remark.value = ''
    images.value = []
    refVideo.value = null
    homeStore.setMyData({ act: 'RunwayMvpRefresh' })
    fetchTokenStatus()
  } catch (error: any) {
    message.error(error.message || '任务提交失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchTokenStatus()
  tokenTimer = setInterval(fetchTokenStatus, 15000)
})
onUnmounted(() => {
  if (tokenTimer) clearInterval(tokenTimer)
})
</script>

<template>
  <div class="space-y-2 p-2">
    <!-- 用户信息 -->
    <div class="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
      <div class="mb-1 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{{ jwtToken ? jwtUsername : '未登录' }}</p>
          <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{{ jwtRole === 'admin' ? '管理员账号' : '普通账号' }}</p>
        </div>
        <div class="flex items-center gap-2">
          <span :class="['text-xs font-medium', concurrencyClass]">{{ concurrencyLabel }}</span>
        </div>
      </div>

      <template v-if="tokenWarnings.length">
        <NAlert v-for="(warn, i) in tokenWarnings" :key="i" type="warning" class="mb-2 text-xs">{{ warn }}</NAlert>
      </template>
    </div>

    <!-- 提示词 -->
    <div class="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
      <label class="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">提示词 *</label>
      <NInput
        v-model:value="prompt"
        type="textarea"
        placeholder="描述你想要生成的视频内容..."
        :autosize="{ minRows: 3, maxRows: 6 }"
        class="rounded-lg"
      />
    </div>

    <!-- 参考图片 -->
    <div class="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
      <label class="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">参考图片 *（最多 {{ MAX_IMAGES }} 张）</label>
      <div class="flex flex-wrap gap-2">
        <div v-for="(img, idx) in images" :key="img.id" class="group relative h-16 w-16 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          <img v-if="img.preview" :src="img.preview" class="h-full w-full object-cover" />
          <div v-if="img.uploading" class="absolute inset-0 flex items-center justify-center bg-black/40">
            <NSpin size="small" />
          </div>
          <button
            v-else
            class="absolute right-0.5 top-0.5 hidden rounded-full bg-black/60 p-0.5 text-white group-hover:block"
            @click="removeImage(idx)"
          >
            <SvgIcon icon="ri:close-line" class="text-sm" />
          </button>
        </div>
        <label
          v-if="remainingSlots > 0"
          class="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-slate-400 transition hover:border-blue-400 hover:text-blue-400 dark:border-slate-600"
        >
          <SvgIcon icon="ri:add-line" class="text-2xl" />
          <input type="file" accept="image/*" multiple class="hidden" @change="handleFileSelect" />
        </label>
      </div>
    </div>

    <!-- 生成设置 -->
    <div class="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
      <label class="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">生成设置</label>
      <div class="space-y-3">

        <!-- 画面比例 -->
        <div>
          <div class="mb-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span>画面比例</span>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="opt in resolutionOptions"
              :key="opt.value"
              class="group flex flex-col items-center gap-2 rounded-xl border px-3 py-3 transition-all duration-200 hover:-translate-y-0.5"
              :class="resolution === opt.value
                ? 'border-cyan-500 bg-gradient-to-b from-white to-cyan-50 shadow-md shadow-cyan-500/20 dark:from-slate-800 dark:to-cyan-950/40 dark:shadow-cyan-500/10'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-600'"
              @click="resolution = opt.value"
            >
              <div
                class="rounded transition-all duration-200"
                :class="resolution === opt.value
                  ? 'border-2 border-cyan-500 bg-gradient-to-br from-cyan-100 to-cyan-200 dark:from-cyan-800/60 dark:to-cyan-700/40'
                  : 'border-2 border-slate-300 bg-gradient-to-br from-slate-100 to-slate-200 group-hover:border-slate-400 dark:border-slate-600 dark:from-slate-700 dark:to-slate-600'"
                :style="{ width: opt.iconW + 'px', height: opt.iconH + 'px' }"
              />
              <div class="text-center">
                <p class="text-xs font-bold" :class="resolution === opt.value ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-700 dark:text-slate-300'">{{ opt.label }}</p>
                <p class="text-[10px]" :class="resolution === opt.value ? 'text-cyan-500/80 dark:text-cyan-400/60' : 'text-slate-400 dark:text-slate-500'">{{ opt.desc }}</p>
              </div>
            </button>
          </div>
        </div>

        <!-- 生成模式 -->
        <div>
          <div class="mb-1 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span>生成模式</span>
          </div>
          <div class="flex gap-2">
            <button
              class="rounded-lg border px-3 py-1.5 text-xs font-medium transition"
              :class="quality === 'std'
                ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'"
              @click="quality = 'std'"
            >
              标准 std
            </button>
            <button
              class="rounded-lg border px-3 py-1.5 text-xs font-medium transition"
              :class="quality === 'pro'
                ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'"
              @click="quality = 'pro'"
            >
              专业 pro
            </button>
          </div>
          <Transition name="hint-fade">
            <p v-if="qualityHints[quality]" class="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{{ qualityHints[quality] }}</p>
          </Transition>
        </div>

        <!-- 参考视频（仅 pro 模式） -->
        <Transition name="hint-fade">
          <div v-if="quality === 'pro'">
            <div class="mb-1 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span>参考视频 *</span>
            </div>
            <div class="flex items-center gap-2">
              <div v-if="refVideo" class="group relative h-16 w-28 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <video v-if="refVideo.preview" :src="refVideo.preview" class="h-full w-full object-cover" muted />
                <div v-if="refVideo.uploading" class="absolute inset-0 flex items-center justify-center bg-black/40">
                  <NSpin size="small" />
                </div>
                <button
                  v-else
                  class="absolute right-0.5 top-0.5 hidden rounded-full bg-black/60 p-0.5 text-white group-hover:block"
                  @click="removeVideo"
                >
                  <SvgIcon icon="ri:close-line" class="text-sm" />
                </button>
              </div>
              <label
                v-if="!refVideo"
                class="flex h-16 w-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-slate-400 transition hover:border-blue-400 hover:text-blue-400 dark:border-slate-600"
              >
                <SvgIcon icon="ri:video-add-line" class="text-xl" />
                <span class="text-[10px]">上传视频</span>
                <input type="file" accept="video/*" class="hidden" @change="handleVideoSelect" />
              </label>
            </div>
            <p class="mt-1 text-[11px] text-amber-500 dark:text-amber-400">专业模式必须上传参考视频，AI 会 1:1 复刻视频中的动作和运动轨迹，分辨率自动升级至 1080p</p>
          </div>
        </Transition>

        <!-- 时长 -->
        <div>
          <div class="mb-1 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span>时长</span>
          </div>
          <div class="flex gap-2">
            <button
              v-for="d in [5, 10, 15]"
              :key="d"
              class="rounded-lg border px-3 py-1.5 text-xs font-medium transition"
              :class="duration === d
                ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'"
              @click="duration = d"
            >
              {{ d }}s
            </button>
          </div>
          <Transition name="hint-fade">
            <p v-if="durationHints[duration]" class="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{{ durationHints[duration] }}</p>
          </Transition>
        </div>

        <!-- 提示词关联度 cfgScale -->
        <div>
          <div class="mb-1 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
            <span>提示词关联度</span>
            <span class="font-mono text-[11px] text-slate-400">{{ cfgScale.toFixed(2) }}</span>
          </div>
          <NSlider v-model:value="cfgScale" :min="0" :max="1" :step="0.05" :tooltip="false" />
          <Transition name="hint-fade">
            <p class="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{{ cfgHint }}</p>
          </Transition>
        </div>

        <!-- 声音 -->
        <div class="flex items-center justify-between">
          <div>
            <span class="text-xs text-slate-600 dark:text-slate-300">生成声音</span>

          </div>
          <NSwitch v-model:value="sound" size="small" />
        </div>

      </div>
    </div>

    <!-- 备注 -->
    <div class="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
      <label class="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">备注（可选）</label>
      <NInput v-model:value="remark" placeholder="给这个任务加个备注..." class="rounded-lg" />
    </div>

    <!-- 提交按钮 -->
    <NButton
      type="primary"
      block
      :loading="loading"
      :disabled="!canSubmit"
      class="rounded-xl"
      @click="submit"
    >
      {{ loading ? '提交中...' : '生成视频' }}
    </NButton>
    <p v-if="quality === 'pro' && (!refVideo || !refVideo.url) && uploadedUrls.length > 0 && prompt.trim()" class="text-center text-[11px] text-amber-500">请上传参考视频后再提交（专业模式必需）</p>
  </div>
</template>

<style scoped>
.hint-fade-enter-active,
.hint-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.hint-fade-enter-from,
.hint-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
