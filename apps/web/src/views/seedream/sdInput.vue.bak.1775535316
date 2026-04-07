<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useMessage, NButton, NInput, NTag, NSlider } from 'naive-ui'
import { clearImageBase64, mlog, upImg } from '@/api'
import { homeStore } from '@/store'
import { seedreamGenerate } from '@/api/seedream'
import { SvgIcon } from '@/components/common'

const f = ref({
  prompt: '',
  negative_prompt: '',
  image: '',
  n: 1,
  aspect_ratio: '1:1',
  quality: 'standard' as 'standard' | 'hd'
})
const st = ref({ bili: 0, isLoading: false })
const fsRef = ref()
const ms = useMessage()

const vf = [
  { s: 'width: 100%; height: 100%;', label: '1:1', value: '1024x1024' },
  { s: 'width: 100%; height: 75%;', label: '4:3', value: '1024x768' },
  { s: 'width: 75%; height: 100%;', label: '3:4', value: '768x1024' },
  { s: 'width: 100%; height: 56%;', label: '16:9', value: '1024x576' },
  { s: 'width: 56%; height: 100%;', label: '9:16', value: '576x1024' },
  { s: 'width: 100%; height: 66%;', label: '3:2', value: '1024x682' },
  { s: 'width: 66%; height: 100%;', label: '2:3', value: '682x1024' },
]

const nOptions = [1, 2, 3, 4]

function selectFile(input: any) {
  upImg(input.target.files[0]).then((d) => {
    f.value.image = d
    fsRef.value = ''
  }).catch((e) => ms.error(e))
}

const clearInput = () => {
  f.value.prompt = ''
  f.value.negative_prompt = ''
  f.value.image = ''
  fsRef.value = ''
}

const createImg = async () => {
  if (!f.value.prompt.trim()) {
    ms.warning('请输入提示词')
    return
  }
  st.value.isLoading = true
  const size = vf[st.value.bili].value
  const payload: any = {
    model: 'seedream-3.0',
    prompt: f.value.prompt,
    size: size,
    n: f.value.n,
    quality: f.value.quality,
  }
  if (f.value.negative_prompt.trim()) {
    payload.negative_prompt = f.value.negative_prompt
  }
  if (f.value.image) {
    payload.image = clearImageBase64(f.value.image)
  }
  try {
    await seedreamGenerate(payload, f.value.prompt, f.value.negative_prompt)
    ms.success('已提交生成')
  } catch (error: any) {
    ms.error(error?.message || '生成失败')
  }
  st.value.isLoading = false
}

onMounted(() => {
  homeStore.setMyData({ ms: ms })
})
</script>

<template>
  <div class="space-y-3 overflow-y-auto p-1">
    <!-- Aspect ratio -->
    <div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/60 dark:bg-slate-800/60">
      <p class="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">画面比例</p>
      <div class="flex gap-1.5">
        <button
          v-for="(item, index) in vf"
          :key="item.value"
          class="flex flex-1 flex-col items-center gap-1 rounded-lg border-2 px-1 py-2 text-[10px] transition"
          :class="
            index === st.bili
              ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:border-cyan-400 dark:bg-cyan-900/30 dark:text-cyan-300'
              : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-600'
          "
          @click="st.bili = index"
        >
          <div class="flex h-5 w-5 items-center justify-center">
            <div class="rounded border-2 dark:border-current" :style="item.s" :class="index === st.bili ? 'border-cyan-500' : 'border-slate-400'" />
          </div>
          <span>{{ item.label }}</span>
        </button>
      </div>
    </div>

    <!-- Generation count & quality -->
    <div class="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/60 dark:bg-slate-800/60">
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-600 dark:text-slate-400">生成张数</span>
        <div class="flex gap-1">
          <button
            v-for="num in nOptions"
            :key="num"
            class="w-7 h-7 rounded-md border text-xs font-medium transition"
            :class="
              f.n === num
                ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:border-cyan-400 dark:bg-cyan-900/30 dark:text-cyan-300'
                : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
            "
            @click="f.n = num"
          >
            {{ num }}
          </button>
        </div>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-600 dark:text-slate-400">画质</span>
        <div class="flex gap-1">
          <button
            v-for="q in (['standard', 'hd'] as const)"
            :key="q"
            class="rounded-md border px-2.5 py-1 text-[11px] font-medium transition"
            :class="
              f.quality === q
                ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:border-cyan-400 dark:bg-cyan-900/30 dark:text-cyan-300'
                : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
            "
            @click="f.quality = q"
          >
            {{ q === 'standard' ? '标准' : '高清' }}
          </button>
        </div>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-600 dark:text-slate-400">反向提示词</span>
        <NInput v-model:value="f.negative_prompt" size="small" class="!w-[65%]" clearable placeholder="不想出现的元素" />
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

    <!-- Image upload & actions -->
    <div class="flex items-end justify-between rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/60 dark:bg-slate-800/60">
      <div>
        <input type="file" ref="fsRef" class="hidden" accept="image/jpeg,image/jpg,image/png,image/gif,image/webp" @change="selectFile" />
        <div
          class="flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 transition hover:border-cyan-400 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-cyan-500"
          @click="fsRef.click()"
        >
          <img v-if="f.image" :src="f.image" class="h-full w-full object-cover" />
          <div v-else class="text-center">
            <SvgIcon icon="ri:image-add-line" class="mx-auto text-xl text-slate-400 dark:text-slate-500" />
            <span class="mt-0.5 block text-[10px] text-slate-400">图生图</span>
          </div>
        </div>
      </div>
      <div class="text-right">
        <div v-if="f.image || f.prompt" class="mb-2 cursor-pointer" @click="clearInput">
          <NTag type="success" size="small" :bordered="false" round>
            <span class="cursor-pointer">清空</span>
          </NTag>
        </div>
        <NButton :loading="st.isLoading" type="primary" @click="createImg()" :disabled="!f.prompt.trim()">
          <SvgIcon icon="ri:sparkling-2-line" class="mr-1 text-sm" />
          生成图片
        </NButton>
      </div>
    </div>

    <!-- Model info -->
    <div class="rounded-lg border border-slate-200/50 bg-slate-50 px-3 py-2 dark:border-slate-700/30 dark:bg-slate-800/30">
      <p class="text-[10px] text-slate-400 dark:text-slate-500">
        Seedream 3.0 · 支持文生图 / 图生图 · 最多4张
      </p>
    </div>
  </div>
</template>
