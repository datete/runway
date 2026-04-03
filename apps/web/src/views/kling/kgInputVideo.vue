<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useMessage, NButton, NInput, NTag, NSelect } from 'naive-ui'
import { clearImageBase64, mlog, upImg } from '@/api'
import { homeStore } from '@/store'
import { klingFeed, klingFetch } from '@/api/kling'
import { t } from '@/locales'
import { SvgIcon } from '@/components/common'

const f = ref({ prompt: '', negative_prompt: '', image: '', image_tail: '', aspect_ratio: '1:1', mode: 'std', duration: '5', model: 'kling-v1-6' })
const st = ref({ bili: 0, isLoading: false, camera_type: '' })

const fsRef = ref()
const fsRef2 = ref()
const ms = useMessage()

const vf = [
  { s: 'width: 100%; height: 100%;', label: '1:1', value: '1:1' },
  { s: 'width: 100%; height: 50%;', label: '16:9', value: '16:9' },
  { s: 'width: 50%; height: 100%;', label: '9:16', value: '9:16' },
]

const modeOptions = [{ label: t('mj.std'), value: 'std' }, { label: t('mj.pro'), value: 'pro' }]
const durationOptions = [{ label: '5s', value: '5' }, { label: '10s', value: '10' }]
const cameraOption = [
  { label: t('mj.cnull'), value: '' },
  { label: t('mj.down_back'), value: 'down_back' },
  { label: t('mj.forward_up'), value: 'forward_up' },
  { label: t('mj.right_turn_forward'), value: 'right_turn_forward' },
  { label: t('mj.left_turn_forward'), value: 'left_turn_forward' },
]
const mvOption = [
  { label: 'kling-v1-6', value: 'kling-v1-6' },
  { label: 'kling-v1-5', value: 'kling-v1-5' },
  { label: 'kling-v1', value: 'kling-v1' },
  { label: 'kling-v2-master', value: 'kling-v2-master' },
]

function selectFile(input: any) {
  upImg(input.target.files[0]).then((d) => {
    f.value.image = d
    fsRef.value = ''
  }).catch((e) => ms.error(e))
}

function selectFile2(input: any) {
  upImg(input.target.files[0]).then((d) => {
    f.value.image_tail = d
    fsRef2.value = ''
    if (f.value.image === '') ms.info(t('mj.needImg'))
  }).catch((e) => ms.error(e))
}

const clearInput = () => {
  f.value.prompt = ''
  f.value.image = ''
  f.value.image_tail = ''
  fsRef.value = ''
  fsRef2.value = ''
}

const createImg = async () => {
  st.value.isLoading = true
  f.value.aspect_ratio = vf[st.value.bili].value
  try {
    let cat = 'text2video'
    const abc: any = { ...f.value }
    if (f.value.image !== '') {
      cat = 'image2video'
      abc.image = clearImageBase64(abc.image)
      if (f.value.image_tail) abc.image_tail = clearImageBase64(f.value.image_tail)
    } else if (st.value.camera_type) {
      abc.camera_control = { type: st.value.camera_type }
    }
    if (abc.model === 'kling-v2-master') delete abc.mode

    const d: any = await klingFetch('/v1/videos/' + cat, abc)
    mlog('img', d)
    klingFeed(d.data.task_id, cat, f.value.prompt)
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
      <div class="flex gap-2">
        <button
          v-for="(item, index) in vf"
          :key="item.value"
          class="flex flex-1 flex-col items-center gap-1 rounded-lg border-2 px-2 py-2 text-xs transition"
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
        <span class="text-xs text-slate-600 dark:text-slate-400">{{ $t('mjset.model') }}</span>
        <n-select v-model:value="f.model" size="small" :options="mvOption" class="!w-[65%]" />
      </div>
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-600 dark:text-slate-400">{{ $t('mj.mode') }}</span>
        <n-select v-model:value="f.mode" size="small" :options="modeOptions" class="!w-[65%]" />
      </div>
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-600 dark:text-slate-400">{{ $t('mj.duration') }}</span>
        <n-select v-model:value="f.duration" size="small" :options="durationOptions" class="!w-[65%]" />
      </div>
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-600 dark:text-slate-400">{{ $t('mj.camera_type') }}</span>
        <n-select v-model:value="st.camera_type" size="small" :options="cameraOption" class="!w-[65%]" />
      </div>
      <div class="flex items-center justify-between">
        <span class="text-xs text-slate-600 dark:text-slate-400">{{ $t('mj.nohead') }}</span>
        <NInput v-model:value="f.negative_prompt" size="small" class="!w-[65%]" clearable :placeholder="$t('mj.negative_prompt')" />
      </div>
    </div>

    <!-- Prompt -->
    <div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/60 dark:bg-slate-800/60">
      <p class="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">{{ $t('video.descpls') }}</p>
      <n-input
        v-model:value="f.prompt"
        :placeholder="$t('video.descpls')"
        type="textarea"
        size="small"
        :autosize="{ minRows: 3, maxRows: 10 }"
      />
    </div>

    <!-- Image upload -->
    <div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/60 dark:bg-slate-800/60">
      <p class="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">参考图片</p>
      <div class="flex gap-3">
        <!-- Start frame -->
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
        <!-- End frame -->
        <div>
          <input type="file" ref="fsRef2" class="hidden" accept="image/jpeg,image/jpg,image/png,image/gif" @change="selectFile2" />
          <div
            class="flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 transition hover:border-cyan-400 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-cyan-500"
            @click="fsRef2.click()"
          >
            <img v-if="f.image_tail" :src="f.image_tail" class="h-full w-full object-cover" />
            <div v-else class="text-center">
              <SvgIcon icon="ri:image-add-line" class="mx-auto text-xl text-slate-400 dark:text-slate-500" />
              <span class="mt-0.5 block text-[10px] text-slate-400">{{ $t('video.endImg') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-between pb-2">
      <div v-if="f.image || f.prompt || f.image_tail" class="cursor-pointer" @click="clearInput">
        <NTag type="success" size="small" :bordered="false" round>
          <span class="cursor-pointer">{{ $t('video.clear') }}</span>
        </NTag>
      </div>
      <div v-else />
      <NButton :loading="st.isLoading" type="primary" @click="createImg()" :disabled="!f.prompt">
        {{ $t('video.generate') }}
      </NButton>
    </div>

    <ul class="text-[12px] text-slate-500 dark:text-slate-400" v-html="$t('mj.klingInfo')" />
  </div>
</template>
