<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useRunwayUser } from '@/composables/useRunwayUser'

const { quota, fetchQuota } = useRunwayUser()

interface Metric {
  label: string
  used: number
  total: number | null
  unlimited: boolean
}

const metrics = computed<Metric[]>(() => [
  {
    label: '并发',
    used: quota.activeTasks,
    total: quota.maxConcurrency,
    unlimited: false,
  },
  {
    label: '今日',
    used: quota.dailyUsed,
    total: quota.dailyQuota || null,
    unlimited: !quota.dailyQuota,
  },
  {
    label: '总量',
    used: quota.totalUsed,
    total: quota.totalQuota || null,
    unlimited: !quota.totalQuota,
  },
])

function percent(m: Metric): number {
  if (m.unlimited || !m.total) return 0
  return Math.min((m.used / m.total) * 100, 100)
}

function isWarning(m: Metric): boolean {
  if (m.unlimited || !m.total) return false
  return m.used / m.total > 0.8
}

function display(m: Metric): string {
  if (m.unlimited) return `${m.used} / 无限制`
  return `${m.used} / ${m.total}`
}

onMounted(() => {
  fetchQuota().catch(() => {})
})
</script>

<template>
  <div class="quota-bar">
    <div
      v-for="(m, i) in metrics"
      :key="i"
      class="quota-item"
    >
      <div class="quota-header">
        <span class="quota-label">{{ m.label }}</span>
        <span class="quota-value" :class="{ warning: isWarning(m) }">{{ display(m) }}</span>
      </div>
      <div class="quota-track">
        <div
          class="quota-fill"
          :class="{ warning: isWarning(m) }"
          :style="{ width: m.unlimited ? '0%' : percent(m) + '%' }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.quota-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 14px;
  height: 42px;
  box-sizing: border-box;
  background: var(--rw-bg-surface);
  border: 1px solid var(--rw-border-light);
  border-radius: var(--rw-radius-md);
}

.quota-item {
  flex: 1;
  min-width: 0;
}

.quota-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 3px;
}

.quota-label {
  font-size: 11px;
  color: var(--rw-text-muted);
  font-weight: 500;
}

.quota-value {
  font-size: 11px;
  color: var(--rw-text-secondary);
  font-variant-numeric: tabular-nums;
}

.quota-value.warning {
  color: var(--rw-status-failed);
}

.quota-track {
  height: 3px;
  background: var(--rw-border);
  border-radius: var(--rw-radius-full);
  overflow: hidden;
}

.quota-fill {
  height: 100%;
  border-radius: var(--rw-radius-full);
  background: var(--rw-primary);
  transition: width 0.3s var(--rw-ease-default);
}

.quota-fill.warning {
  background: var(--rw-status-failed);
}
</style>
