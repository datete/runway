<script setup lang="ts">
import type { ReviewTask } from '@/api/review'
defineProps<{ task: ReviewTask }>()
</script>

<template>
  <div class="flex items-start justify-end gap-3">
    <div class="max-w-[78%] rounded-2xl rounded-tr-sm border border-violet-400/30 bg-gradient-to-br from-violet-500/20 to-fuchsia-500/15 px-4 py-3 text-sm text-slate-100 backdrop-blur">
      <div class="mb-1 text-[10px] uppercase tracking-wider text-violet-300">生成描述</div>
      <div class="whitespace-pre-wrap">{{ task.genPrompt }}</div>

      <div class="mt-3 border-t border-white/10 pt-2">
        <div class="mb-1 text-[10px] uppercase tracking-wider text-fuchsia-300">质检要求</div>
        <div class="whitespace-pre-wrap text-[13px] text-slate-200">{{ task.qcPrompt }}</div>
      </div>

      <div v-if="task.refImages && task.refImages.length" class="mt-3 flex gap-1.5">
        <img
          v-for="(src, i) in task.refImages"
          :key="i"
          :src="src"
          class="h-12 w-12 rounded-md border border-white/10 object-cover"
        />
      </div>

      <div class="mt-3 flex flex-wrap gap-1.5 text-[10px]">
        <span class="rounded-full bg-black/30 px-2 py-0.5 text-slate-300">🎯 {{ task.targetCount }}</span>
        <span class="rounded-full bg-black/30 px-2 py-0.5 text-slate-300">×{{ task.overGenRatio }}</span>
        <span class="rounded-full bg-black/30 px-2 py-0.5 text-slate-300">↻ {{ task.maxRounds }}</span>
        <span class="rounded-full bg-black/30 px-2 py-0.5 text-slate-300">{{ task.aspectRatio }}</span>
        <span class="rounded-full bg-black/30 px-2 py-0.5 text-slate-300">{{ (task.resolution || '').toUpperCase() }}</span>
      </div>
    </div>
    <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-200">
      U
    </div>
  </div>
</template>
