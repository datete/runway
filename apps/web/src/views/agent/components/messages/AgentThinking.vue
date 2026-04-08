<script setup lang="ts">
import { ref } from 'vue'
defineProps<{ text: string; active?: boolean }>()
const expanded = ref(true)
</script>

<template>
  <div class="rounded-lg border border-white/5 bg-black/30">
    <button
      class="flex w-full items-center justify-between px-3 py-1.5 text-[11px] text-slate-400 hover:text-slate-200"
      @click="expanded = !expanded"
    >
      <span class="flex items-center gap-1.5">
        <svg class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m0 16v1m-9-9H2m2.05-6.95l.707.707M19.243 5.757l.707-.707M20 12h2m-2.05 6.95l-.707-.707M4.757 19.243l-.707.707M12 7a5 5 0 015 5c0 1.657-.895 3.157-2.343 4.243L12 20l-2.657-3.757C7.895 15.157 7 13.657 7 12a5 5 0 015-5z" />
        </svg>
        思考过程 <span v-if="active" class="text-violet-300">· 流式中</span>
      </span>
      <svg
        class="h-3 w-3 transition-transform"
        :class="expanded ? 'rotate-180' : ''"
        fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
    <div v-if="expanded" class="max-h-56 overflow-y-auto border-t border-white/5 px-3 py-2">
      <pre class="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-400">{{ text }}<span v-if="active" class="caret">▌</span></pre>
    </div>
  </div>
</template>

<style scoped>
.caret {
  animation: blink 1s steps(1) infinite;
  color: #a78bfa;
}
@keyframes blink {
  50% { opacity: 0; }
}
</style>
