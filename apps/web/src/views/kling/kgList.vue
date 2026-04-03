<script setup lang="ts">
import { LazyImg, Waterfall } from 'vue-waterfall-plugin-next'
import 'vue-waterfall-plugin-next/dist/style.css'

import { KlingTask, klingStore } from '@/api/klingStore'
import { nextTick, ref, watch } from 'vue'
import { NEmpty, NButton, NPopover, NButtonGroup, NSpin, NImage, NPopconfirm, useMessage } from 'naive-ui'
import { ViewCard } from 'vue-waterfall-plugin-next/dist/types/types/waterfall'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { homeStore } from '@/store'
import { klingFeed } from '@/api/kling'
import { mlog } from '@/api'
import { SvgIcon } from '@/components/common'
import { t } from '@/locales'
import KgImage from './kgImage.vue'

const list = ref<KlingTask[]>([])
const list2 = ref<ViewCard[]>([])

const st = ref({ show: true, showImg: '', isLoad: false, pIndex: -1, isStart: true })
const csuno = new klingStore()
const ms = useMessage()

const initLoad = () => {
  const arr = csuno.getObjs()
  list.value = arr.reverse()
  toList2()
}

const toList2 = () => {
  list2.value = list.value.map((v, k) => {
    const url = v.data.task_result?.images?.[0]?.url || v.data.task_result?.videos?.[0]?.url || ''
    return { url, id: v.request_id, index: k, src: url, isLoad: 0, task: v }
  })
}

const breakpoints = {
  2000: { rowPerView: 6 },
  1600: { rowPerView: 5 },
  1200: { rowPerView: 4 },
  800: { rowPerView: 3 },
  500: { rowPerView: 2 },
}

const { isMobile } = useBasicLayout()
const showImg = ref<typeof NImage>()

const goShow = (item: any) => {
  if (isMobile.value) return
  st.value.show = true
  st.value.showImg = item.url
  nextTick(() => showImg.value?.click())
}

const goShow2 = (item: any) => {
  if (isMobile.value) return
  st.value.show = true
  st.value.showImg = (item.base64 ? item.base64 : item.src) as string
  nextTick(() => showImg.value?.click())
}

initLoad()

watch(() => homeStore.myData.act, (n) => {
  if (n === 'KlingFeed') {
    st.value.isStart = false
    initLoad()
  }
})

const getFeed = (item: any) => {
  mlog('item', item)
  klingFeed(item.task.data.task_id, item.task.cat, item.task.prompt)
}

const deleteGo = (item: any) => {
  mlog('deleteGo', item)
  if (csuno.delete(item.id)) {
    ms.success(t('common.deleteSuccess'))
    initLoad()
  }
}
</script>

<template>
  <div v-if="list.length > 0" class="p-4">
    <Waterfall :list="list2" :breakpoints="breakpoints" class="!bg-transparent" v-if="list2.length">
      <template #item="{ item, url, index }">
        <div class="group/item relative overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-slate-700/50 dark:bg-slate-800/80">
          <!-- Failed state -->
          <div v-if="item.task.data.task_status === 'failed'" class="flex h-[200px] w-full flex-col items-center justify-center gap-2 bg-red-50/50 dark:bg-red-900/10">
            <SvgIcon icon="ri:error-warning-line" class="text-3xl text-red-400 dark:text-red-500" />
            <p class="text-xs text-red-500 dark:text-red-400">{{ t('video.failed') }}</p>
            <p class="text-[10px] text-slate-400">ID: {{ item.task.data.task_id }}</p>
          </div>

          <!-- Retry state -->
          <template v-else-if="(!item.task.last_feed || ((new Date().getTime()) - item.task.last_feed) > 20 * 1000) && !item.src">
            <div class="flex h-[200px] w-full flex-col items-center justify-center gap-2">
              <SvgIcon icon="ri:refresh-line" class="text-2xl text-slate-400" />
              <NButton size="small" type="primary" @click="getFeed(item)">{{ $t('video.repeat') }}</NButton>
            </div>
          </template>

          <!-- Content -->
          <template v-else>
            <!-- Video -->
            <div v-if="item.task.cat !== 'image' && item.src" class="relative">
              <video
                v-if="item.src"
                :src="item.src"
                loop
                playsinline
                disableremoteplayback
                disablepictureinpicture
                :controls="st.pIndex === index"
                class="h-full w-full object-cover"
              />
              <a
                target="_blank"
                :href="item.src"
                class="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition hover:bg-black/50"
              >
                <SvgIcon icon="ri:play-fill" class="text-lg" />
              </a>
            </div>

            <!-- Image -->
            <KgImage :item="item" @kg-success="item.isLoad = 1" @kg-click="goShow2" v-else-if="item.src" />

            <!-- Placeholder -->
            <div v-else class="h-[200px] w-[200px]" />

            <!-- Loading overlay -->
            <section v-if="!item.src || (item.isLoad === 0 && st.isStart && item.task.cat === 'image')" class="absolute inset-0">
              <div class="flex h-full w-full items-center justify-center bg-white/60 dark:bg-slate-900/60">
                <n-spin size="large" />
              </div>
            </section>
          </template>

          <!-- Prompt overlay -->
          <section
            v-if="item.task.prompt"
            class="absolute inset-x-0 bottom-0 backdrop-blur-md"
            :class="item.src ? ['invisible', 'group-hover/item:visible'] : []"
          >
            <div class="flex items-baseline justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent p-3">
              <div class="line-clamp-2 text-[13px] leading-tight text-white/90">
                <template v-if="item.task.prompt">{{ item.task.prompt }}</template>
              </div>
              <div class="flex-shrink-0">
                <n-popconfirm @positive-click="() => deleteGo(item)" placement="bottom">
                  <template #trigger>
                    <button class="flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition hover:bg-white/20 hover:text-white">
                      <SvgIcon icon="mdi:delete" />
                    </button>
                  </template>
                  {{ $t('mj.confirmDelete') }}
                </n-popconfirm>
              </div>
            </div>
          </section>
        </div>
      </template>
    </Waterfall>
  </div>

  <!-- Empty state -->
  <div v-else class="flex h-full w-full flex-col items-center justify-center gap-3">
    <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
      <SvgIcon icon="ri:video-line" class="text-3xl text-slate-400 dark:text-slate-500" />
    </div>
    <NEmpty :description="$t('video.nodata')" />
  </div>

  <NImage :src="st.showImg" ref="showImg" v-if="st.showImg" :width="1" />
</template>
