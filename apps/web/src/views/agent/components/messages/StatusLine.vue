<script setup lang="ts">
import type { StatusMessage } from '../../eventReducer'
defineProps<{ msg: StatusMessage }>()
const colorOf = (lv: string) => {
  switch (lv) {
    case 'success': return 'text-emerald-300'
    case 'warn': return 'text-amber-300'
    case 'error': return 'text-rose-300'
    default: return 'text-slate-400'
  }
}
</script>

<template>
  <div class="flex items-center gap-2 pl-11 text-[11px]" :class="colorOf(msg.level)">
    <span class="h-px flex-1 bg-current opacity-20" />
    <span>{{ msg.text }}</span>
    <span class="h-px flex-1 bg-current opacity-20" />
  </div>
</template>
