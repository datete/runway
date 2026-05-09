<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRunwayUser } from '@/composables/useRunwayUser'
import StatusBadge from './StatusBadge.vue'

const { quota, headers, isLoggedIn } = useRunwayUser()

const expanded = ref(false)
const jobs = ref<any[]>([])
const panelRef = ref<HTMLElement | null>(null)
const badgeRef = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

function truncate(text: string, max = 30): string {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '...' : text
}

async function fetchJobs() {
  if (!isLoggedIn.value) return
  try {
    const res = await fetch('/api/runway/jobs?page=1&limit=5', { headers: headers() })
    if (res.ok) {
      const data = await res.json()
      jobs.value = data.jobs ?? data.data ?? data ?? []
    }
  } catch { /* silent */ }
}

function toggle() {
  expanded.value = !expanded.value
  if (expanded.value) fetchJobs()
}

function onClickOutside(e: MouseEvent) {
  if (!expanded.value) return
  const target = e.target as Node
  if (panelRef.value?.contains(target) || badgeRef.value?.contains(target)) return
  expanded.value = false
}

function progressPercent(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const percent = n > 1 ? n : n * 100
  return Math.max(0, Math.min(100, Math.round(percent)))
}

function progressText(job: any): string {
  if (job.status === 'completed') return '100%'
  const percent = progressPercent(job.progress)
  if (percent != null) return percent + '%'
  if (job.status === 'pending' || job.status === 'queued') return '0%'
  return ''
}

onMounted(() => {
  document.addEventListener('click', onClickOutside, true)
  timer = setInterval(() => {
    if (expanded.value) fetchJobs()
  }, 10000)
})

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside, true)
  if (timer) clearInterval(timer)
})

const visible = computed(() => quota.activeTasks > 0)
</script>

<template>
  <Transition name="fab">
    <div v-if="visible" class="task-fab" ref="badgeRef">
      <button class="task-fab__btn" @click="toggle" :class="{ 'task-fab__btn--active': expanded }">
        <span class="task-fab__pulse" />
        <span class="task-fab__count">{{ quota.activeTasks }}</span>
      </button>

      <Transition name="panel">
        <div v-if="expanded" class="task-fab__panel" ref="panelRef">
          <div class="task-fab__header">
            <span>Recent Tasks</span>
            <button class="task-fab__refresh" @click.stop="fetchJobs" title="Refresh">&#x21bb;</button>
          </div>
          <div v-if="jobs.length === 0" class="task-fab__empty">No tasks yet</div>
          <ul v-else class="task-fab__list">
            <li v-for="job in jobs" :key="job.id || job._id" class="task-fab__item">
              <span class="task-fab__prompt">{{ truncate(job.prompt || job.textPrompt || '') }}</span>
              <div class="task-fab__meta">
                <StatusBadge :status="job.status" />
                <span class="task-fab__progress">{{ progressText(job) }}</span>
              </div>
            </li>
          </ul>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.task-fab {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 999;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

/* ── Circle button ── */
.task-fab__btn {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 1px solid var(--rw-border-primary);
  background: var(--rw-gradient-primary);
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--rw-shadow-md), var(--rw-shadow-glow-primary);
  transition: transform 0.25s var(--rw-ease-bounce), box-shadow 0.25s var(--rw-ease-default);
}
.task-fab__btn:hover {
  transform: scale(1.08);
  box-shadow: var(--rw-shadow-lg), 0 0 20px rgba(139, 92, 246, 0.35);
}
.task-fab__btn--active {
  transform: scale(0.95);
}

.task-fab__count {
  position: relative;
  z-index: 1;
}

/* pulse ring */
.task-fab__pulse {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid var(--rw-primary-hover);
  animation: fab-pulse 2s ease-in-out infinite;
  pointer-events: none;
}

@keyframes fab-pulse {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50%      { opacity: 0;   transform: scale(1.35); }
}

/* ── Panel ── */
.task-fab__panel {
  width: 300px;
  max-height: 360px;
  overflow-y: auto;
  border-radius: var(--rw-radius-lg);
  border: 1px solid var(--rw-border);
  background: var(--rw-bg-card);
  backdrop-filter: var(--rw-blur-lg);
  box-shadow: var(--rw-shadow-lg);
  padding: 0;
}

.task-fab__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--rw-text-primary);
  border-bottom: 1px solid var(--rw-border-light);
}

.task-fab__refresh {
  background: none;
  border: none;
  color: var(--rw-text-secondary);
  font-size: 16px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--rw-radius-sm);
  transition: color 0.2s, background 0.2s;
}
.task-fab__refresh:hover {
  color: var(--rw-primary-light);
  background: var(--rw-bg-surface-hover);
}

.task-fab__empty {
  padding: 24px 14px;
  text-align: center;
  color: var(--rw-text-muted);
  font-size: 13px;
}

.task-fab__list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}

.task-fab__item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--rw-border-light);
  transition: background 0.15s;
}
.task-fab__item:last-child {
  border-bottom: none;
}
.task-fab__item:hover {
  background: var(--rw-bg-surface-hover);
}

.task-fab__prompt {
  font-size: 12px;
  color: var(--rw-text-secondary);
  line-height: 1.4;
  word-break: break-all;
}

.task-fab__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-fab__progress {
  font-size: 11px;
  color: var(--rw-text-muted);
  font-variant-numeric: tabular-nums;
}

/* ── Transitions ── */
.fab-enter-active, .fab-leave-active {
  transition: opacity 0.3s var(--rw-ease-default), transform 0.3s var(--rw-ease-bounce);
}
.fab-enter-from, .fab-leave-to {
  opacity: 0;
  transform: scale(0.5) translateY(20px);
}

.panel-enter-active, .panel-leave-active {
  transition: opacity 0.2s var(--rw-ease-default), transform 0.2s var(--rw-ease-default);
}
.panel-enter-from, .panel-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}

/* scrollbar */
.task-fab__panel::-webkit-scrollbar { width: 4px; }
.task-fab__panel::-webkit-scrollbar-thumb {
  background: var(--rw-scrollbar-thumb);
  border-radius: var(--rw-radius-full);
}
.task-fab__panel::-webkit-scrollbar-thumb:hover {
  background: var(--rw-scrollbar-thumb-hover);
}
</style>
