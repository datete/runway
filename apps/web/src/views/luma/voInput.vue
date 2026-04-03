<script setup lang="ts">
import { NTabs, NTabPane, NTag } from 'naive-ui'
import LumaInput from './lumaInput.vue'
import RunwayInput from './runwayMvpInput.vue'
import KlingInput from '../kling/kgInput.vue'
import PikaInput from './pikaInput.vue'
import { mlog } from '@/api'
import { gptServerStore, homeStore } from '@/store'
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import PixInput from './pixInput.vue'
import VideoInput from '../video/input.vue'
import { useRunwayJwt } from '@/composables/useRunwayJwt'
import { SvgIcon } from '@/components/common'

const route = useRoute()
const { token: jwtToken, username: jwtUsername, role: jwtRole, removeToken } = useRunwayJwt()

const st = ref({ tab: '' })

const handleUpdateValue = (v: string) => {
  mlog('handleUpdateValue', v)
  gptServerStore.setMyData({ TAB_VIDEO: v })
}

const handleLogout = () => {
  removeToken()
  window.location.reload()
}

const openAdmin = () => {
  homeStore.setMyData({ act: 'ShowAdmin' })
}

const initLoad = () => {
  if (route.query.tab) {
    st.value.tab = 'pixverse'
    const tt = (route.query.tab as string).toLocaleLowerCase()
    if (['luma', 'runway', 'pika', 'kling', 'runwayml', 'pixverse', 'all'].indexOf(tt) > -1)
      st.value.tab = tt
    handleUpdateValue(st.value.tab)
  }
  else {
    st.value.tab = gptServerStore.myData.TAB_VIDEO ? gptServerStore.myData.TAB_VIDEO : 'runway'
  }
  if (st.value.tab === 'runwayml') st.value.tab = 'runway'
}
initLoad()
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- User status bar -->
    <div
      v-if="jwtToken"
      class="flex items-center justify-between border-b border-slate-200 bg-white/90 px-3 py-2 backdrop-blur-sm dark:border-slate-700/60 dark:bg-slate-900/90"
    >
      <div class="flex items-center gap-2 min-w-0">
        <div class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-xs font-bold text-white">
          {{ jwtUsername?.charAt(0)?.toUpperCase() || 'U' }}
        </div>
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-slate-800 dark:text-slate-100 leading-tight">
            {{ jwtUsername || '用户' }}
          </p>
        </div>
        <NTag :bordered="false" size="tiny" :type="jwtRole === 'admin' ? 'error' : 'info'" round>
          {{ jwtRole === 'admin' ? '管理' : '用户' }}
        </NTag>
      </div>
      <div class="flex items-center gap-1">
        <button
          v-if="jwtRole === 'admin'"
          class="rounded-md px-2 py-1 text-xs text-cyan-600 transition hover:bg-cyan-50 dark:text-cyan-400 dark:hover:bg-cyan-900/30"
          @click="openAdmin"
        >
          <SvgIcon icon="ri:settings-3-line" class="text-sm" />
        </button>
        <button
          class="rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-red-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-red-400"
          @click="handleLogout"
        >
          <SvgIcon icon="ri:logout-box-r-line" class="text-sm" />
        </button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex-1 overflow-y-auto">
      <n-tabs
        type="line"
        :tabs-padding="1"
        class="abc1234"
        animated
        :default-value="st.tab"
        @update:value="handleUpdateValue"
      >
        <n-tab-pane name="all" tab="All">
          <VideoInput />
        </n-tab-pane>
        <n-tab-pane name="runway" tab="可灵" style="--n-tab-gap: 10px">
          <RunwayInput />
        </n-tab-pane>
        <n-tab-pane name="pixverse" tab="Pixverse">
          <PixInput />
        </n-tab-pane>
        <n-tab-pane name="kling" :tab="$t('mj.kling')">
          <KlingInput />
        </n-tab-pane>
        <n-tab-pane name="pika" tab="Pika">
          <PikaInput />
        </n-tab-pane>
        <n-tab-pane name="luma" tab="Luma">
          <LumaInput />
        </n-tab-pane>
      </n-tabs>
    </div>
  </div>
</template>

<style lang="css" scoped>
.abc1234 {
  --n-tab-gap: 20px !important;
}
</style>
