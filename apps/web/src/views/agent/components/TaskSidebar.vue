<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NScrollbar, NBadge } from 'naive-ui'
import { listReviewTasks, type ReviewTask } from '@/api/review'
import { refreshTick } from '../agentStore'

const props = defineProps<{ activeTaskId: string | null }>()
const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'new-task'): void
}>()

const tasks = ref<ReviewTask[]>([])
const loading = ref(false)
let timer: any = null

const TERMINAL = ["done","partial","failed","error","cancelled"]
const hasActive = () => tasks.value.some((t) => !TERMINAL.includes(t.status))

const load = async () => {
  loading.value = true
  try {
    const { tasks: list } = await listReviewTasks({ limit: 50 })
    tasks.value = list
  } catch (e) {
    // silent
  } finally {
    loading.value = false
  }
}

const tick = async () => {
  await load()
  if (!hasActive() && timer) {
    clearInterval(timer)
    timer = null
  }
}

const statusColor = (s: string) => {
  switch (s) {
    case 'running':
    case 'generating':
    case 'reviewing':
      return { dot: 'bg-violet-400 animate-pulse', label: '运行中', text: 'text-violet-300' }
    case 'done':
      return { dot: 'bg-emerald-400', label: '完成', text: 'text-emerald-300' }
    case 'partial':
      return { dot: 'bg-amber-400', label: '部分', text: 'text-amber-300' }
    case 'failed':
    case 'error':
      return { dot: 'bg-rose-400', label: '失败', text: 'text-rose-300' }
    case 'cancelled':
      return { dot: 'bg-slate-500', label: '已取消', text: 'text-slate-400' }
    default:
      return { dot: 'bg-slate-400', label: s || '待执行', text: 'text-slate-300' }
  }
}

const short = (s?: string) => (s || '').slice(0, 36)

const fmtTime = (iso: string) => {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diff = (now.getTime() - d.getTime()) / 1000
    if (diff < 60) return '刚刚'
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前'
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前'
    return d.toLocaleDateString()
  } catch {
    return ''
  }
}

onMounted(() => {
  load().then(() => {
    if (hasActive()) timer = setInterval(tick, 5000)
  })
})

watch(
  () => props.activeTaskId,
  () => {
    if (!timer) {
      load().then(() => {
        if (hasActive()) timer = setInterval(tick, 5000)
      })
    }
  },
)
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
watch(refreshTick, () => {
  load().then(() => {
    if (hasActive() && !timer) timer = setInterval(tick, 5000)
  })
})
</script>

<template>
  <aside class="flex w-[320px] shrink-0 flex-col border-r border-white/10 bg-white/[0.02] backdrop-blur">
    <div class="shrink-0 p-3">
      <button
        class="new-task-btn flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-white transition"
        @click="emit('new-task')"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        新建任务
      </button>
    </div>

    <div class="shrink-0 px-4 pb-2 text-[11px] uppercase tracking-wider text-slate-500">任务历史</div>

    <NScrollbar class="flex-1">
      <div class="space-y-1 p-2">
        <div
          v-for="t in tasks"
          :key="t.id"
          :class="[
            'group cursor-pointer rounded-lg border px-3 py-2.5 transition',
            activeTaskId === t.id
              ? 'border-violet-400/40 bg-violet-500/10 shadow-[0_0_20px_-8px_rgba(139,92,246,0.6)]'
              : 'border-transparent hover:border-white/10 hover:bg-white/[0.04]',
          ]"
          @click="emit('select', t.id)"
        >
          <div class="mb-1 flex items-center gap-2">
            <span :class="['h-1.5 w-1.5 rounded-full', statusColor(t.status).dot]" />
            <span :class="['text-[10px]', statusColor(t.status).text]">{{ statusColor(t.status).label }}</span>
            <span class="ml-auto text-[10px] text-slate-500">{{ fmtTime(t.createdAt) }}</span>
          </div>
          <div class="line-clamp-2 text-xs text-slate-200">
            {{ short(t.title || t.genPrompt) || '(未命名任务)' }}
          </div>
          <div v-if="typeof t.passedCount === 'number'" class="mt-1 text-[10px] text-slate-500">
            通过 {{ t.passedCount }} / 目标 {{ t.targetCount }}
          </div>
        </div>

        <div v-if="!loading && tasks.length === 0" class="px-4 py-10 text-center text-xs text-slate-500">
          暂无任务，点击上方按钮创建
        </div>
      </div>
    </NScrollbar>
  </aside>
</template>

<style scoped>
.new-task-btn {
  background-image: linear-gradient(90deg, #8b5cf6, #d946ef);
  box-shadow: 0 0 20px rgba(168, 85, 247, 0.35);
}
.new-task-btn:hover {
  box-shadow: 0 0 28px rgba(217, 70, 239, 0.55);
}
</style>
