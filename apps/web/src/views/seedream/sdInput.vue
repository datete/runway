<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useMessage, NButton, NInput, NTag } from 'naive-ui'
import { homeStore } from '@/store'
import { seedreamGenerate, seedreamUpload } from '@/api/seedream'
import { SvgIcon } from '@/components/common'

interface RefImg { id: string; preview: string; url: string; assetId: string; filename: string; uploading: boolean }

const f = ref({
  prompt: '',
  aspectRatio: '1:1' as '1:1' | '16:9' | '9:16' | '4:3' | '3:4',
  resolution: '2k' as '1k' | '2k' | '4k',
  numImages: 1 as 1 | 2 | 3 | 4,
  exploreMode: true,
})
const refImages = ref<RefImg[]>([])
const st = ref({ isLoading: false })
const fsRef = ref<HTMLInputElement | null>(null)
const ms = useMessage()

const ratios = [
  { label: '1:1',  value: '1:1',  s: 'width:20px;height:20px;' },
  { label: '16:9', value: '16:9', s: 'width:24px;height:14px;' },
  { label: '9:16', value: '9:16', s: 'width:14px;height:24px;' },
  { label: '4:3',  value: '4:3',  s: 'width:22px;height:16px;' },
  { label: '3:4',  value: '3:4',  s: 'width:16px;height:22px;' },
] as const

const resolutions = [
  { label: '1K', value: '1k' },
  { label: '2K', value: '2k' },
  { label: '4K', value: '4k' },
] as const

const nOptions = [1, 2, 3, 4] as const

const MAX_REFS = 4

const onPickFiles = async (e: Event) => {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  for (const file of files) {
    if (refImages.value.length >= MAX_REFS) { ms.warning(`最多 ${MAX_REFS} 张参考图`); break }
    const id = Math.random().toString(36).slice(2, 10)
    const preview: string = await new Promise(r => {
      const rr = new FileReader(); rr.onload = () => r(String(rr.result || '')); rr.readAsDataURL(file)
    })
    const item: RefImg = { id, preview, url: '', assetId: '', filename: file.name, uploading: true }
    refImages.value.push(item)
    try {
      const d = await seedreamUpload(file)
      item.url = d.url
      item.assetId = d.assetId
      item.uploading = false
    } catch (err: any) {
      ms.error(`上传失败：${err?.message || file.name}`)
      refImages.value = refImages.value.filter(x => x.id !== id)
    }
  }
}

const removeRef = (id: string) => {
  refImages.value = refImages.value.filter(x => x.id !== id)
}

const clearInput = () => { f.value.prompt = ''; refImages.value = [] }

const createImg = async () => {
  if (!f.value.prompt.trim()) { ms.warning('请输入提示词'); return }
  if (refImages.value.some(r => r.uploading)) { ms.warning('参考图上传中，请稍候'); return }
  st.value.isLoading = true
  try {
    const referenceImages = refImages.value.length > 0
      ? refImages.value.map((r, i) => ({ tag: `IMG_${i + 1}`, url: r.url, assetId: r.assetId }))
      : undefined
    await seedreamGenerate({
      aspectRatio: f.value.aspectRatio,
      resolution: f.value.resolution,
      numImages: f.value.numImages,
      exploreMode: f.value.exploreMode,
      referenceImages,
    }, f.value.prompt.trim())
    ms.success('已提交生成')
  } catch (error: any) {
    ms.error(error?.message || '生成失败')
  }
  st.value.isLoading = false
}

onMounted(() => { homeStore.setMyData({ ms }) })
</script>

<template>
  <div class="space-y-3 overflow-y-auto p-1">
    <!-- Aspect ratio -->
    <div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/60 dark:bg-slate-800/60">
      <p class="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">画面比例</p>
      <div class="flex gap-1.5">
        <button
          v-for="item in ratios"
          :key="item.value"
          class="flex flex-1 flex-col items-center gap-1 rounded-lg border-2 px-1 py-2 text-[10px] transition"
          :class="f.aspectRatio === item.value
            ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:border-cyan-400 dark:bg-cyan-900/30 dark:text-cyan-300'
            : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-600'"
          @click="f.aspectRatio = item.value"
        >
          <div class="flex h-6 w-6 items-center justify-center">
            <div class="rounded border-2" :style="item.s" :class="f.aspectRatio === item.value ? 'border-cyan-500' : 'border-slate-400'" />
          </div>
          <span>{{ item.label }}</span>
        </button>
      </div>
    </div>

    <!-- Resolution & numImages -->
    <div class="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/60 dark:bg-slate-800/60">
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-600 dark:text-slate-400">分辨率</span>
        <div class="flex gap-1">
          <button
            v-for="r in resolutions"
            :key="r.value"
            class="rounded-md border px-2.5 py-1 text-[11px] font-medium transition"
            :class="f.resolution === r.value
              ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:border-cyan-400 dark:bg-cyan-900/30 dark:text-cyan-300'
              : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'"
            @click="f.resolution = r.value"
          >
            {{ r.label }}
          </button>
        </div>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-600 dark:text-slate-400">生成张数</span>
        <div class="flex gap-1">
          <button
            v-for="num in nOptions"
            :key="num"
            class="w-7 h-7 rounded-md border text-xs font-medium transition"
            :class="f.numImages === num
              ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:border-cyan-400 dark:bg-cyan-900/30 dark:text-cyan-300'
              : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'"
            @click="f.numImages = num as 1 | 2 | 3 | 4"
          >
            {{ num }}
          </button>
        </div>
      </div>
    </div>

    <!-- Reference images -->
    <div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/60 dark:bg-slate-800/60">
      <div class="mb-2 flex items-center justify-between">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400">参考图（可选，最多 {{ MAX_REFS }} 张）</p>
        <span class="text-[10px] text-slate-400">图生图</span>
      </div>
      <input ref="fsRef" type="file" class="hidden" accept="image/png,image/jpeg,image/webp,image/gif" multiple @change="onPickFiles" />
      <div class="flex flex-wrap gap-2">
        <div
          v-for="img in refImages"
          :key="img.id"
          class="relative h-16 w-16 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
        >
          <img :src="img.preview" class="h-full w-full object-cover" />
          <div v-if="img.uploading" class="absolute inset-0 flex items-center justify-center bg-black/40 text-[10px] text-white">上传中</div>
          <button
            class="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[10px] text-white hover:bg-red-500"
            @click="removeRef(img.id)"
          >×</button>
        </div>
        <button
          v-if="refImages.length < MAX_REFS"
          class="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-slate-400 transition hover:border-cyan-400 hover:text-cyan-500 dark:border-slate-600 dark:bg-slate-800"
          @click="fsRef?.click()"
        >
          <SvgIcon icon="ri:image-add-line" class="text-xl" />
        </button>
      </div>
    </div>

    <!-- Prompt -->
    <div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/60 dark:bg-slate-800/60">
      <p class="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">提示词</p>
      <n-input
        v-model:value="f.prompt"
        placeholder="描述你想生成的图片内容..."
        type="textarea"
        size="small"
        :autosize="{ minRows: 3, maxRows: 10 }"
      />
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/60 dark:bg-slate-800/60">
      <div v-if="f.prompt || refImages.length" class="cursor-pointer" @click="clearInput">
        <NTag type="success" size="small" :bordered="false" round>清空</NTag>
      </div>
      <div v-else />
      <NButton :loading="st.isLoading" type="primary" @click="createImg()" :disabled="!f.prompt.trim()">
        <SvgIcon icon="ri:sparkling-2-line" class="mr-1 text-sm" />
        生成图片
      </NButton>
    </div>

    <div class="rounded-lg border border-slate-200/50 bg-slate-50 px-3 py-2 dark:border-slate-700/30 dark:bg-slate-800/30">
      <p class="text-[10px] text-slate-400 dark:text-slate-500">
        Seedream 5.0 · via Runway · 支持 1K/2K/4K · 最多 4 张 · 图生图可参考最多 {{ MAX_REFS }} 张
      </p>
    </div>
  </div>
</template>
