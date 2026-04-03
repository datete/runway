<script setup lang="ts">
import VoInput from './voInput.vue'
import VoList from './voList.vue'
import RunwayList from './runwayMvpList.vue'
import PikaList from './pikaList.vue'
import KlingList from '../kling/kgList.vue'
import RunmlList from './runmlList.vue'
import PixList from './pixList.vue'
import VideoList from '../video/list.vue'
import RunwayLoginModal from './RunwayLoginModal.vue'
import { gptServerStore } from '@/store'
import { computed, ref, watch } from 'vue'
import { useRunwayJwt } from '@/composables/useRunwayJwt'

const { token: jwtToken } = useRunwayJwt()

const showPanel = ref(false)
const showLogin = ref(!jwtToken.value)

watch(jwtToken, (v) => {
  showLogin.value = !v
})

const handleLoggedIn = () => {
  showLogin.value = false
}
</script>

<template>
  <!-- Login gate: full-screen login when not authenticated -->
  <div v-if="!jwtToken" class="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 via-cyan-50 to-slate-200 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
    <div class="text-center">
      <div class="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/25">
        <svg class="h-10 w-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      </div>
      <h1 class="mb-2 text-2xl font-bold text-slate-800 dark:text-slate-100">视频工作台</h1>
      <p class="mb-8 text-sm text-slate-500 dark:text-slate-400">请登录后开始创建视频任务</p>
    </div>
    <RunwayLoginModal :show="showLogin" @update:show="showLogin = $event" @logged-in="handleLoggedIn" />
  </div>

  <!-- Main layout: only visible after login -->
  <div v-else class="flex h-full w-full flex-col md:flex-row">
    <!-- Mobile toggle bar -->
    <div class="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-[#1e1e1e] md:hidden">
      <span class="text-sm font-medium text-slate-700 dark:text-slate-300">视频工作台</span>
      <button
        class="rounded-md bg-cyan-500 px-3 py-1.5 text-xs text-white active:bg-cyan-600"
        @click="showPanel = !showPanel"
      >
        {{ showPanel ? '收起' : '提交任务' }}
      </button>
    </div>

    <!-- Input panel -->
    <div :class="['md:w-[300px] md:h-full md:overflow-y-auto md:block', showPanel ? 'block' : 'hidden md:block']">
      <VoInput />
    </div>

    <!-- List panel -->
    <div class="min-h-0 flex-1 overflow-y-auto bg-[#fafbfc] pt-2 dark:bg-[#18181c] md:h-full">
      <RunwayList v-if="gptServerStore.myData.TAB_VIDEO === 'runway'" />
      <KlingList v-else-if="gptServerStore.myData.TAB_VIDEO === 'kling'" />
      <PikaList v-else-if="gptServerStore.myData.TAB_VIDEO === 'pika'" />
      <RunmlList v-else-if="gptServerStore.myData.TAB_VIDEO === 'runwayml'" />
      <PixList v-else-if="gptServerStore.myData.TAB_VIDEO === 'pixverse'" />
      <VideoList v-else-if="gptServerStore.myData.TAB_VIDEO === 'all'" />
      <VoList v-else />
    </div>
  </div>
</template>
