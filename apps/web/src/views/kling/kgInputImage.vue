<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useMessage, NButton, NInput, NTag } from 'naive-ui'
import { clearImageBase64, mlog, upImg } from '@/api'
import { homeStore } from '@/store'
import { klingFeed, klingFetch } from '@/api/kling'
import { SvgIcon } from '@/components/common'

const f = ref({ prompt: '', negative_prompt: '', image: '', image_fidelity: 0.5, n: 1, aspect_ratio: '1:1' })
const st = ref({ bili: 0, isLoading: false })

const fsRef = ref()
const ms = useMessage()

const vf = [
  { s: 'width: 100%; height: 100%;', label: '1:1', value: '1:1' },
  { s: 'width: 100%; height: 75%;', label: '4:3', value: '4:3' },
  { s: 'width: 75%; height: 100%;', label: '3:4', value: '3:4' },
  { s: 'width: 100%; height: 50%;', label: '16:9', value: '16:9' },
  { s: 'width: 50%; height: 100%;', label: '9:16', value: '9:16' },
]

function selectFile(input: any) {
  upImg(input.target.files[0]).then((d) => {
    f.value.image = d
    fsRef.value = ''
  }).catch((e) => ms.error(e))
}

const clearInput = () => {
  f.value.prompt = ''
  f.value.image = ''
  fsRef.value = ''
}

const createImg = async () => {
  st.value.isLoading = true
  f.value.aspect_ratio = vf[st.value.bili].value
  const abc = { ...f.value }
  if (abc.image) abc.image = clearImageBase64(abc.image)
  try {
    const d: any = await klingFetch('/v1/images/generations ', abc)
    mlog('img', d)
    klingFeed(d.data.task_id, 'image', f.value.prompt)
  } catch (error) {}
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
          class="flex flex-1 flex-col items-center gap-1 rounded-lg border-2 px-1.5 py-2 text-xs transition"
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

    <!-- Settings -->
    <div class="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/60 dark:bg-slate-800/60">
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-600 dark:text-slate-400">{{ $t('mj.nohead') }}</span>
        <NInput v-model="f.negative_prompt" size="small" class="!w-[65%]" clearable :placeholder="$t('mj.negative_prompt')" />
      </div>
    </div>

    <!-- Prompt -->
    <div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/60 dark:bg-slate-800/60">
      <p class="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">{{ $t('mj.ideopls') }}</p>
      <n-input
        v-model:value="f.prompt"
        :placeholder="$t('mj.ideopls')"
        type="textarea"
        size="small"
        :autosize="{ minRows: 3, maxRows: 10 }"
      />
    </div>

    <!-- Image upload & actions -->
    <div class="flex items-end justify-between rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/60 dark:bg-slate-800/60">
      <div>
        <input type="file" ref="fsRef" class="hidden" accept="image/jpeg,image/jpg,image/png,image/gif" @change="selectFile" />
        <div
          class="flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 transition hover:border-cyan-400 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-cyan-500"
          @click="fsRef.click()"
        >
          <img v-if="f.image" :src="f.image" class="h-full w-full object-cover" />
          <div v-else class="text-center">
            <SvgIcon icon="ri:image-add-line" class="mx-auto text-xl text-slate-400 dark:text-slate-500" />
            <span class="mt-0.5 block text-[10px] text-slate-400">{{ $t('video.selectimg') }}</span>
          </div>
        </div>
      </div>
      <div class="text-right">
        <div v-if="f.image || f.prompt" class="mb-2 cursor-pointer" @click="clearInput">
          <NTag type="success" size="small" :bordered="false" round>
            <span class="cursor-pointer">{{ $t('video.clear') }}</span>
          </NTag>
        </div>
        <NButton :loading="st.isLoading" type="primary" @click="createImg()" :disabled="!f.prompt">
          {{ $t('mjchat.imgcreate') }}
        </NButton>
      </div>
    </div>
  </div>
</template>
