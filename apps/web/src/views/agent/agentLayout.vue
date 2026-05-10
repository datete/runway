<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import TaskSidebar from './components/TaskSidebar.vue'
import NewTaskModal from './components/NewTaskModal.vue'
import TaskConversation from './components/TaskConversation.vue'
import RunwayLoginModal from '../luma/RunwayLoginModal.vue'
import { UserCenter, QuotaBar } from '@/components/common'
import { useRunwayJwt } from '@/composables/useRunwayJwt'
import { useRunwayUser } from '@/composables/useRunwayUser'
import { listReviewTasks } from '@/api/review'

const router = useRouter()
const { token: jwtToken } = useRunwayJwt()
const { username } = useRunwayUser()

const showLogin = ref(!jwtToken.value)
const showUserCenter = ref(false)
const showNewTaskModal = ref(false)
const activeTaskId = ref<string | null>(null)
const backendMissing = ref(false)

watch(
  jwtToken,
  (v) => {
    showLogin.value = !v
    if (v) probeBackend()
  },
  { immediate: false },
)

const probeBackend = () => {
  listReviewTasks({ limit: 1 })
    .then(() => (backendMissing.value = false))
    .catch((e: any) => {
      if (e?.code === 404) backendMissing.value = true
      else console.warn("[agent] probe failed", e)
    })
}

const displayName = computed(() => username.value || '用户')
const handleLoggedIn = () => (showLogin.value = false)
const handleBack = () => router.push('/')
const handleTaskCreated = (taskId: string) => {
  activeTaskId.value = taskId
  showNewTaskModal.value = false
}

if (jwtToken.value) probeBackend()
</script>

<template>
  <div v-if="!jwtToken" class="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#0a0a0f] via-[#1a1024] to-[#0a0a0f]">
    <div class="text-center">
      <div class="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-500/25">
        <svg class="h-10 w-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </div>
      <h1 class="mb-2 text-2xl font-bold text-slate-100">Agent · 生图审图</h1>
      <p class="mb-8 text-sm text-slate-400">请登录后开始创建智能审图任务</p>
      <button
        class="rounded-lg bg-violet-500 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-600 active:bg-violet-700"
        @click="showLogin = true"
      >
        登录工作台
      </button>
    </div>
    <RunwayLoginModal :show="showLogin" @update:show="showLogin = $event" @logged-in="handleLoggedIn" />
  </div>

  <div v-else class="flex h-full w-full flex-col bg-gradient-to-br from-[#0a0a0f] via-[#1a1024] to-[#0a0a0f] text-slate-200">
    <!-- TopBar -->
    <div class="flex h-12 shrink-0 items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 backdrop-blur">
      <div class="flex items-center gap-3">
        <button
          class="flex h-8 items-center gap-1 rounded-md px-2 text-sm text-slate-300 transition hover:bg-white/10"
          @click="handleBack"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span>返回</span>
        </button>
        <span class="h-4 w-px bg-white/10" />
        <span class="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-sm font-semibold text-transparent">
          Agent · 生图审图
        </span>
      </div>
      <div class="flex items-center gap-3">
        <span class="hidden text-xs text-slate-400 sm:inline">{{ displayName }}</span>
        <div class="hidden sm:block"><QuotaBar /></div>
        <button
          class="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/15 text-violet-300 transition hover:bg-violet-500/25"
          title="用户中心"
          @click="showUserCenter = true"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5.121 17.804A9 9 0 0112 15a9 9 0 016.879 2.804M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    </div>

    <div v-if="backendMissing" class="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-300">
      后端未就绪 · /api/review/* 接口尚未部署
    </div>

    <!-- 2-column -->
    <div class="flex min-h-0 flex-1">
      <TaskSidebar
        class="hidden md:flex"
        :active-task-id="activeTaskId"
        @select="activeTaskId = $event"
        @new-task="showNewTaskModal = true"
      />
      <div class="min-h-0 min-w-0 flex-1">
        <TaskConversation v-if="activeTaskId" :key="activeTaskId" :task-id="activeTaskId" />
        <div v-else class="flex h-full w-full items-center justify-center">
          <div class="max-w-md text-center">
            <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 ring-1 ring-white/10">
              <svg class="h-8 w-8 text-violet-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 4v-4z" />
              </svg>
            </div>
            <h2 class="mb-2 text-lg font-semibold text-slate-100">开始一个新的审图对话</h2>
            <p class="mb-6 text-sm text-slate-400">左侧选择已有任务，或创建一个新任务。Agent 会实时流式展示生成、审核、决策全过程。</p>
            <button
              class="rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-500/30 transition hover:shadow-violet-500/50"
              @click="showNewTaskModal = true"
            >
              + 新建任务
            </button>
          </div>
        </div>
      </div>
    </div>

    <NewTaskModal v-model:show="showNewTaskModal" @created="handleTaskCreated" />
    <UserCenter v-model:show="showUserCenter" />
  </div>
</template>
