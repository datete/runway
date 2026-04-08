<script setup lang="ts">
import { nextTick, onBeforeUnmount, reactive, ref, shallowRef, triggerRef, watch } from 'vue'
import { NScrollbar, NButton, useMessage } from 'naive-ui'
import { getReviewTask, cancelReviewTask, extendReviewTask, type ReviewTask } from '@/api/review'
import { useRunwayJwt } from '@/composables/useRunwayJwt'
import { openTaskStream, type SSEConnection } from '../sseClient'
import { applyEvent, createReducerState, type AgentMessage, type ReducerState } from '../eventReducer'
import UserBriefBubble from './messages/UserBriefBubble.vue'
import RoundCard from './messages/RoundCard.vue'
import AnalysisCard from './messages/AnalysisCard.vue'
import StatusLine from './messages/StatusLine.vue'

const props = defineProps<{ taskId: string }>()
const message = useMessage()
const { token } = useRunwayJwt()

const task = ref<ReviewTask | null>(null)
const loading = ref(true)
const reducer = shallowRef<ReducerState>(createReducerState())
const scrollRef = ref<any>(null)
const stickToBottom = ref(true)
let sse: SSEConnection | null = null

const loadTask = async () => {
  loading.value = true
  try {
    const { task: t } = await getReviewTask(props.taskId)
    task.value = t
  } catch (e: any) {
    message.error(e?.message || '任务加载失败')
  } finally {
    loading.value = false
  }
}

const connect = () => {
  if (!token.value) return
  sse?.close()
  reducer.value = createReducerState()
  triggerRef(reducer)
  sse = openTaskStream(props.taskId, token.value, (event, data) => {
    applyEvent(reducer.value, event, data)
    triggerRef(reducer)
    // refresh task meta on terminal events
    if (event === 'task_done' || event === 'task_partial' || event === 'error') {
      loadTask()
      sse?.close()
      sse = null
    }
    nextTick(() => scrollToBottomIfStuck())
  })
}

const scrollToBottomIfStuck = () => {
  if (!stickToBottom.value) return
  const sb = scrollRef.value
  if (!sb) return
  const el = sb.$el?.querySelector('.n-scrollbar-container') || sb.scrollbarInstRef?.containerRef
  if (el) {
    el.scrollTop = el.scrollHeight
  }
}

const onScroll = (e: Event) => {
  const el = e.target as HTMLElement
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight
  stickToBottom.value = dist < 40
}

watch(
  () => props.taskId,
  () => {
    loadTask()
    connect()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  sse?.close()
})

const terminal = () => reducer.value.terminal || ['done', 'partial', 'failed', 'error', 'cancelled'].includes(task.value?.status || '')

const doCancel = async () => {
  try {
    await cancelReviewTask(props.taskId)
    message.success('已取消')
    loadTask()
  } catch (e: any) {
    message.error(e?.message || '取消失败')
  }
}

const doExtend = async () => {
  try {
    await extendReviewTask(props.taskId)
    message.success('已追加一轮')
    connect()
    loadTask()
  } catch (e: any) {
    message.error(e?.message || '追加失败')
  }
}

const downloadAll = () => {
  const imgs = reducer.value.passedImages
  imgs.forEach((url, i) => {
    setTimeout(() => {
      const a = document.createElement('a')
      a.href = url
      a.download = `agent-${props.taskId}-${i + 1}.png`
      a.target = '_blank'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }, i * 120)
  })
}
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <!-- conversation header -->
    <div class="flex shrink-0 items-center justify-between border-b border-white/10 bg-white/[0.02] px-5 py-3 backdrop-blur">
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium text-slate-100">
          {{ task?.title || task?.genPrompt || '任务' }}
        </div>
        <div class="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
          <span>状态: {{ task?.status || '-' }}</span>
          <span>·</span>
          <span>目标 {{ task?.targetCount || 0 }}</span>
          <span v-if="typeof task?.passedCount === 'number'">· 已通过 {{ task?.passedCount }}</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <NButton v-if="!terminal()" size="small" quaternary @click="doCancel">取消任务</NButton>
      </div>
    </div>

    <!-- stream -->
    <NScrollbar ref="scrollRef" class="flex-1" :on-scroll="onScroll">
      <div class="mx-auto max-w-[900px] space-y-5 px-5 py-6">
        <UserBriefBubble v-if="task" :task="task" />

        <!-- intro agent bubble -->
        <div v-if="task" class="flex items-start gap-3">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm font-semibold text-white shadow-lg shadow-violet-500/30">
            A
          </div>
          <div class="flex-1 rounded-2xl rounded-tl-sm border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur">
            <div class="text-sm text-slate-200">
              收到。我会按目标 <span class="text-violet-300">{{ task.targetCount }}</span> 张、过量系数
              <span class="text-violet-300">{{ task.overGenRatio }}×</span>、最多
              <span class="text-violet-300">{{ task.maxRounds }}</span> 轮的策略执行。
              生成后我会逐张按质检清单打分，保留通过的，分析被拒原因并在下一轮优化 prompt。
            </div>
          </div>
        </div>

        <template v-for="(msg, idx) in (reducer.messages as AgentMessage[])" :key="idx">
          <StatusLine v-if="msg.kind === 'status'" :msg="msg" />
          <RoundCard v-else-if="msg.kind === 'round'" :msg="msg" :thinking-by-item="reducer.thinkingByItem" />
          <AnalysisCard v-else-if="msg.kind === 'analysis'" :msg="msg" />
          <div v-else-if="msg.kind === 'final'" class="flex items-start gap-3">
            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm font-semibold text-white">A</div>
            <div class="flex-1 rounded-2xl rounded-tl-sm border px-4 py-4 backdrop-blur"
              :class="msg.status === 'done' ? 'border-emerald-400/30 bg-emerald-500/[0.06]' : msg.status === 'partial' ? 'border-amber-400/30 bg-amber-500/[0.06]' : 'border-rose-400/30 bg-rose-500/[0.06]'"
            >
              <div class="mb-2 flex items-center gap-2 text-sm font-medium">
                <span v-if="msg.status === 'done'" class="text-emerald-300">✅ 任务完成</span>
                <span v-else-if="msg.status === 'partial'" class="text-amber-300">⚠️ 部分完成</span>
                <span v-else class="text-rose-300">❌ 任务失败</span>
                <span class="text-xs text-slate-400">共通过 {{ msg.passed }} 张</span>
              </div>
              <div v-if="msg.message" class="mb-3 text-xs text-slate-400">{{ msg.message }}</div>
              <div class="flex flex-wrap gap-2">
                <NButton v-if="msg.passed > 0" size="small" class="agent-pill" @click="downloadAll">
                  📥 下载通过的 {{ msg.passed }} 张
                </NButton>
                <NButton v-if="msg.status === 'partial'" size="small" secondary @click="doExtend">
                  ➕ 再开一轮
                </NButton>
              </div>
            </div>
          </div>
        </template>

        <div v-if="loading && reducer.messages.length === 0" class="py-10 text-center text-xs text-slate-500">加载中...</div>
      </div>
    </NScrollbar>
  </div>
</template>

<style scoped>
.agent-pill {
  background-image: linear-gradient(90deg, #8b5cf6, #d946ef) !important;
  color: #fff !important;
  border: 0 !important;
}
</style>
