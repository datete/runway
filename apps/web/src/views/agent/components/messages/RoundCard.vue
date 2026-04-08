<script setup lang="ts">
import { computed } from 'vue'
import { NPopover } from 'naive-ui'
import type { RoundMessage, ItemState } from '../../eventReducer'
import AgentThinking from './AgentThinking.vue'

const props = defineProps<{
  msg: RoundMessage
  thinkingByItem: Record<string, string>
}>()

const activeItem = computed(() => props.msg.items.find((i) => i.status === 'reviewing'))
const activeThinking = computed(() =>
  activeItem.value ? props.thinkingByItem[activeItem.value.itemId] || '' : '',
)

const borderClass = (it: ItemState) => {
  switch (it.status) {
    case 'passed':
      return 'border-emerald-400/60 shadow-[0_0_20px_-6px_rgba(52,211,153,0.6)]'
    case 'rejected':
      return 'border-rose-400/60'
    case 'failed':
      return 'border-slate-600'
    case 'reviewing':
      return 'border-violet-400/70 shadow-[0_0_20px_-6px_rgba(139,92,246,0.8)] animate-pulse'
    case 'generating':
      return 'border-fuchsia-400/50'
    case 'generated':
      return 'border-white/20'
    default:
      return 'border-white/10'
  }
}

const statusLabel = (it: ItemState) => {
  switch (it.status) {
    case 'queued': return '排队中'
    case 'generating': return `生成 ${it.percent ?? 0}%`
    case 'generated': return '待审核'
    case 'reviewing': return '审核中'
    case 'passed': return '通过'
    case 'rejected': return '拒绝'
    case 'failed': return '失败'
    default: return it.status
  }
}
</script>

<template>
  <div class="flex items-start gap-3">
    <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm font-semibold text-white shadow-lg shadow-violet-500/30">
      A
    </div>
    <div class="flex-1 space-y-3 rounded-2xl rounded-tl-sm border border-white/10 bg-white/[0.04] px-4 py-4 backdrop-blur">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-200">
            Round {{ msg.round }}
          </span>
          <span class="text-sm text-slate-200">生成 {{ msg.batchSize }} 张参考图</span>
        </div>
        <div v-if="msg.ended" class="text-[11px] text-slate-400">
          <span class="text-emerald-300">{{ msg.passed ?? 0 }} 通过</span>
          ·
          <span class="text-rose-300">{{ msg.rejected ?? 0 }} 拒</span>
          <span v-if="msg.failed"> · <span class="text-slate-500">{{ msg.failed }} 失败</span></span>
        </div>
      </div>
      <div v-if="msg.hint" class="text-[11px] italic text-slate-400">{{ msg.hint }}</div>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        <NPopover
          v-for="it in msg.items"
          :key="it.itemId"
          trigger="hover"
          placement="top"
          :disabled="!it.reason && !(it.suggestions && it.suggestions.length)"
        >
          <template #trigger>
            <div
              :class="[
                'group relative aspect-square overflow-hidden rounded-lg border-2 bg-black/40 transition',
                borderClass(it),
              ]"
            >
              <img v-if="it.imageUrl" :src="it.imageUrl" class="h-full w-full object-cover fade-in" />
              <div v-else class="absolute inset-0 animate-pulse bg-gradient-to-br from-white/5 to-white/[0.02]" />
              <div
                v-if="it.status === 'generating' && it.percent !== undefined"
                class="absolute inset-x-0 bottom-0 h-1 bg-black/40"
              >
                <div class="h-full bg-fuchsia-400 transition-all" :style="{ width: it.percent + '%' }" />
              </div>
              <div class="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-medium"
                :class="{
                  'text-emerald-300': it.status === 'passed',
                  'text-rose-300': it.status === 'rejected',
                  'text-violet-300': it.status === 'reviewing',
                  'text-fuchsia-300': it.status === 'generating',
                  'text-slate-300': it.status === 'queued' || it.status === 'generated',
                }"
              >
                {{ statusLabel(it) }}
              </div>
            </div>
          </template>
          <div class="max-w-xs space-y-1.5 text-xs">
            <div v-if="it.reason">
              <div class="mb-0.5 text-[10px] uppercase tracking-wider text-rose-300">拒因</div>
              <div class="text-slate-200">{{ it.reason }}</div>
            </div>
            <div v-if="it.suggestions && it.suggestions.length">
              <div class="mb-0.5 text-[10px] uppercase tracking-wider text-violet-300">建议</div>
              <ul class="list-disc pl-4 text-slate-300">
                <li v-for="(s, i) in it.suggestions" :key="i">{{ s }}</li>
              </ul>
            </div>
          </div>
        </NPopover>
      </div>

      <AgentThinking v-if="activeThinking" :text="activeThinking" :active="true" />
    </div>
  </div>
</template>

<style scoped>
.fade-in {
  animation: fade 0.4s ease-out;
}
@keyframes fade {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}
</style>
