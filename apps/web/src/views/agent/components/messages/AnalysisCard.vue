<script setup lang="ts">
import { computed } from 'vue'
import type { AnalysisMessage } from '../../eventReducer'

const props = defineProps<{ msg: AnalysisMessage }>()

const maxCount = computed(() => Math.max(1, ...props.msg.topReasons.map((r) => r.count)))
</script>

<template>
  <div class="flex items-start gap-3">
    <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-fuchsia-500 text-sm font-semibold text-white">
      🧠
    </div>
    <div class="flex-1 rounded-2xl rounded-tl-sm border border-amber-400/20 bg-amber-500/[0.04] px-4 py-3 backdrop-blur">
      <div class="mb-2 flex items-center gap-2">
        <span class="text-[10px] uppercase tracking-wider text-amber-300">拒因聚合分析</span>
        <span class="text-[11px] text-slate-400">Round {{ msg.round }} 结束</span>
      </div>

      <div v-if="msg.topReasons.length" class="space-y-1.5">
        <div v-for="(r, i) in msg.topReasons" :key="i" class="flex items-center gap-2 text-[11px]">
          <div class="w-40 shrink-0 truncate text-slate-300">{{ r.reason }}</div>
          <div class="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
            <div
              class="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-400"
              :style="{ width: (r.count / maxCount) * 100 + '%' }"
            />
          </div>
          <div class="w-6 shrink-0 text-right text-slate-400">{{ r.count }}</div>
        </div>
      </div>

      <div v-if="msg.rewrittenPromptHint" class="mt-3 rounded-lg border border-violet-400/20 bg-violet-500/[0.08] p-2">
        <div class="mb-1 text-[10px] uppercase tracking-wider text-violet-300">下一轮 Prompt 优化</div>
        <div class="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-200">{{ msg.rewrittenPromptHint }}</div>
      </div>
    </div>
  </div>
</template>
