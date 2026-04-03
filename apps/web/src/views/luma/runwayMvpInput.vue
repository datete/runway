<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NAlert, NButton, NInput, NSpin, NSwitch, NTag, useMessage } from 'naive-ui'
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

const tokenWarnings = ref<string[]>([])
const activeTasks = ref(0)
const maxConcurrency = ref(2)
const tokenList = ref<TokenStatus[]>([])
let tokenTimer: ReturnType<typeof setInterval> | null = null

const isUploading = computed(() => images.value.some((item) => item.uploading))
const uploadedUrls = computed(() => images.value.filter((item) => item.url).map((item) => item.url))
const remainingSlots = computed(() => Math.max(0, MAX_IMAGES - images.value.length))

const canSubmit = computed(() => {
  if (!jwtToken.value) return false
  if (!prompt.value.trim()) return false
  if (uploadedUrls.value.length === 0) return false
  if (loading.value || isUploading.value) return false
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
    // 网络抖动时保持静默，避免轮询提示干扰
  }
}

const handleFileSelect = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const fileList = Array.from(input.files || []).slice(0, remainingSlots.value)
  if (fileList.length === 0) return

  for (const file of fileList) {
    const id = createUid()
    images.value.push({
      id,
      preview: '',
      url: '',
      uploading: true,
    })

    const reader = new FileReader()
    reader.onload = async (readerEvent) => {
      const base64 = String(readerEvent.target?.result || '')
      if (!base64) {
        removeImageById(id)
        message.error(`图片读取失败：${file.name}`)
        return
      }

      updateImage(id, { preview: base64 })

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

const submit = async () => {
  if (!canSubmit.value) return

  loading.value = true
  try {
    const payload = {
      prompt: prompt.value.trim(),
      mode: 'image_to_video',
      exploreMode: exploreMode.value,
      duration: duration.value,
      remark: remark.value.trim() || undefined,
      imageUrls: uploadedUrls.value,
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
  <div class="space-y-4 p-3">
    <div
      class="rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/95"
    >
      <div class="mb-3 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            {{ jwtToken ? jwtUsername : '未登录' }}
          </p>
          <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {{ jwtRole === 'admin' ? '管理员账号' : '普通账号' }}
          </p>
        </div>
        <NTag :bordered="false" type="info" size="small">{{ concurrencyLabel }}</NTag>
      </div>

      <div class="flex items-center gap-2 text-xs" :class="concurrencyClass">
        <span
          class="h-2 w-2 rounded-full"
          :class="
            activeTasks >= maxConcurrency
              ? 'bg-amber-500'
              : activeTasks > 0
                ? 'bg-cyan-500'
                : 'bg-slate-400 dark:bg-slate-500'
          "
        />
        <span>{{ concurrencyLabel }}</span>
      </div>
    </div>

    <NAlert
      v-if="!jwtToken"
      type="warning"
      class="rounded-xl"
      title="尚未登录"
    >
      请先登录账号，再上传图片并提交视频任务。
    </NAlert>

    <NAlert
      v-if="tokenWarnings.length > 0"
      type="warning"
      class="rounded-xl"
      title="令牌状态提醒"
    >
      <div class="space-y-1 text-xs">
        <p v-for="warning in tokenWarnings" :key="warning">{{ warning }}</p>
      </div>
    </NAlert>

    <div
      class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="mb-3 flex items-center justify-between">
        <p class="text-sm font-semibold text-slate-800 dark:text-slate-100">参考图片</p>
        <p class="text-xs text-slate-500 dark:text-slate-400">最多 {{ MAX_IMAGES }} 张</p>
      </div>

      <div v-if="images.length > 0" class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div
          v-for="(image, index) in images"
          :key="image.id"
          class="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
        >
          <img v-if="image.preview" :src="image.preview" class="h-full w-full object-cover" />

          <div v-if="image.uploading" class="absolute inset-0 flex items-center justify-center bg-black/45">
            <NSpin size="small" />
          </div>

          <button
            v-else
            class="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white opacity-0 transition group-hover:opacity-100"
            @click="removeImage(index)"
          >
            <SvgIcon icon="ri:close-line" />
          </button>

          <div
            v-if="image.url && !image.uploading"
            class="absolute bottom-1.5 right-1.5 rounded-full bg-emerald-500/95 px-1.5 py-0.5 text-[10px] text-white"
          >
            已上传
          </div>
        </div>

        <label
          v-if="remainingSlots > 0"
          class="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 transition hover:border-cyan-400 dark:border-slate-700 dark:bg-slate-800/70 dark:hover:border-cyan-500"
        >
          <input type="file" class="hidden" accept="image/*" multiple @change="handleFileSelect" />
          <SvgIcon icon="ri:image-add-line" class="text-2xl text-slate-400 dark:text-slate-500" />
          <span class="mt-1 text-xs text-slate-500 dark:text-slate-400">继续添加</span>
        </label>
      </div>

      <label
        v-else
        class="block cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center transition hover:border-cyan-400 dark:border-slate-700 dark:bg-slate-800/70 dark:hover:border-cyan-500"
      >
        <input type="file" class="hidden" accept="image/*" multiple @change="handleFileSelect" />
        <div class="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-slate-200/70 dark:bg-slate-700/70">
          <SvgIcon icon="ri:upload-cloud-2-line" class="text-3xl text-slate-500 dark:text-slate-300" />
        </div>
        <p class="text-sm font-medium text-slate-700 dark:text-slate-200">点击上传参考图片</p>
        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">支持常见图片格式，最多 4 张</p>
      </label>
    </div>

    <div class="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div>
        <p class="mb-1 text-xs text-slate-500 dark:text-slate-400">提示词</p>
        <NInput
          v-model:value="prompt"
          type="textarea"
          :rows="4"
          placeholder="描述你想生成的视频内容、风格、镜头语言和动作细节"
          @keydown.ctrl.enter="submit"
        />
      </div>

      <div>
        <p class="mb-1 text-xs text-slate-500 dark:text-slate-400">备注（可选）</p>
        <NInput v-model:value="remark" placeholder="例如：用于电商首页首屏素材" />
      </div>

      <div>
        <p class="mb-2 text-xs text-slate-500 dark:text-slate-400">视频时长</p>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="second in [5, 10, 15]"
            :key="second"
            class="rounded-lg border px-3 py-2 text-sm font-medium transition"
            :class="
              duration === second
                ? 'border-cyan-500 bg-cyan-500 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-cyan-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-cyan-600'
            "
            @click="duration = second"
          >
            {{ second }} 秒
          </button>
        </div>
      </div>

      <div class="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/80">
        <div>
          <p class="text-sm font-medium text-slate-700 dark:text-slate-200">探索模式</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">开启后会提供更有探索性的生成结果</p>
        </div>
        <NSwitch v-model:value="exploreMode" size="small" />
      </div>

      <NButton
        type="primary"
        size="large"
        block
        :loading="loading"
        :disabled="!canSubmit"
        @click="submit"
      >
        <template #icon>
          <SvgIcon icon="ri:sparkling-2-line" />
        </template>
        {{ loading ? '提交中...' : '提交视频任务' }}
      </NButton>
    </div>
  </div>
</template>
