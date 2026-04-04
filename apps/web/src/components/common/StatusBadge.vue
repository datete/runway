<script setup lang="ts">
interface Props {
  status: string
}

const props = defineProps<Props>()

const statusLabelMap: Record<string, string> = {
  pending: '排队中',
  queued: '排队中',
  submitted: '已提交',
  processing: '生成中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  deleted: '已删除',
}

const label = computed(() => statusLabelMap[props.status] ?? props.status)
</script>

<template>
  <span class="status-badge" :class="`status-badge--${status}`">
    <span v-if="status === 'processing'" class="status-badge__pulse" />
    {{ label }}
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  font-size: 12px;
  line-height: 20px;
  font-weight: 500;
  border-radius: var(--rw-radius-full);
  white-space: nowrap;
  border: 1px solid transparent;
  transition: opacity 0.2s var(--rw-ease-default);
}

/* ── Status variants ── */
.status-badge--pending,
.status-badge--queued {
  color: var(--rw-status-pending);
  background: rgba(156, 163, 175, 0.12);
  border-color: rgba(156, 163, 175, 0.2);
}

.status-badge--submitted {
  color: var(--rw-accent);
  background: rgba(56, 189, 248, 0.12);
  border-color: rgba(56, 189, 248, 0.2);
}

.status-badge--processing {
  color: var(--rw-status-processing);
  background: rgba(167, 139, 250, 0.12);
  border-color: rgba(167, 139, 250, 0.2);
}

.status-badge--completed {
  color: var(--rw-status-completed);
  background: rgba(52, 211, 153, 0.12);
  border-color: rgba(52, 211, 153, 0.2);
}

.status-badge--failed {
  color: var(--rw-status-failed);
  background: rgba(248, 113, 113, 0.12);
  border-color: rgba(248, 113, 113, 0.2);
}

.status-badge--cancelled {
  color: var(--rw-text-muted);
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

.status-badge--deleted {
  color: var(--rw-text-disabled);
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(255, 255, 255, 0.05);
  text-decoration: line-through;
}

/* ── Processing pulse dot ── */
.status-badge__pulse {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--rw-status-processing);
  animation: status-pulse 1.4s ease-in-out infinite;
}

@keyframes status-pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.75);
  }
}
</style>
