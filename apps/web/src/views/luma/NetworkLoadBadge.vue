<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { SvgIcon } from '@/components/common'

interface NetworkCounters {
  rxBytes: number
  txBytes: number
}

interface NetworkResponse {
  ok: boolean
  ts: number
  total: NetworkCounters
  interfaces?: Array<NetworkCounters & { name: string }>
}

const POLL_MS = 1000

const loading = ref(true)
const online = ref(false)
const rxBps = ref(0)
const txBps = ref(0)
const interfaceLabel = ref('')
let lastSample: { ts: number; rxBytes: number; txBytes: number } | null = null
let timer: number | undefined
let inFlight = false

const downLabel = computed(() => formatSpeed(rxBps.value))
const upLabel = computed(() => formatSpeed(txBps.value))
const stateTitle = computed(() => online.value ? `采样网卡 ${interfaceLabel.value || 'primary'}` : '网络负载暂不可用')

function formatSpeed(bytesPerSecond: number) {
  const value = Math.max(0, bytesPerSecond)
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB/s`
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB/s`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB/s`
  return `${Math.round(value)} B/s`
}

async function fetchNetworkLoad() {
  if (inFlight) return
  inFlight = true
  try {
    const response = await fetch('/api/runway/system/network', { cache: 'no-store' })
    if (!response.ok) throw new Error(String(response.status))
    const body = await response.json() as NetworkResponse
    const total = body.total || { rxBytes: 0, txBytes: 0 }
    const current = {
      ts: Number(body.ts) || Date.now(),
      rxBytes: Number(total.rxBytes) || 0,
      txBytes: Number(total.txBytes) || 0,
    }
    if (lastSample) {
      const seconds = Math.max(0.25, (current.ts - lastSample.ts) / 1000)
      rxBps.value = Math.max(0, (current.rxBytes - lastSample.rxBytes) / seconds)
      txBps.value = Math.max(0, (current.txBytes - lastSample.txBytes) / seconds)
    }
    lastSample = current
    interfaceLabel.value = (body.interfaces || []).map(item => item.name).join(' + ')
    online.value = true
  } catch {
    online.value = false
  } finally {
    loading.value = false
    inFlight = false
  }
}

onMounted(() => {
  fetchNetworkLoad()
  timer = window.setInterval(fetchNetworkLoad, POLL_MS)
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <div class="network-load-badge" :title="stateTitle">
    <div class="network-load-title">
      <span class="network-load-dot" :class="{ online, loading }" />
      <span>网络负载</span>
    </div>
    <div class="network-load-metrics">
      <span class="network-load-metric down">
        <SvgIcon icon="ri:arrow-down-line" class="network-load-icon" />
        <b>{{ downLabel }}</b>
      </span>
      <span class="network-load-separator" />
      <span class="network-load-metric up">
        <SvgIcon icon="ri:arrow-up-line" class="network-load-icon" />
        <b>{{ upLabel }}</b>
      </span>
    </div>
  </div>
</template>

<style scoped>
.network-load-badge {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 30px;
  padding: 6px 9px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.026);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
}

.network-load-title,
.network-load-metrics,
.network-load-metric {
  display: flex;
  align-items: center;
}

.network-load-title {
  gap: 6px;
  color: rgba(255, 255, 255, 0.42);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.network-load-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
}

.network-load-dot.online {
  background: rgba(52, 211, 153, 0.95);
  box-shadow: 0 0 8px rgba(52, 211, 153, 0.35);
}

.network-load-dot.loading {
  animation: networkPulse 0.9s ease-in-out infinite;
}

.network-load-metrics {
  gap: 7px;
  min-width: 0;
}

.network-load-metric {
  gap: 3px;
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
}

.network-load-metric b {
  color: rgba(255, 255, 255, 0.78);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.network-load-icon {
  font-size: 11px;
}

.network-load-metric.down .network-load-icon {
  color: rgba(56, 189, 248, 0.82);
}

.network-load-metric.up .network-load-icon {
  color: rgba(251, 191, 36, 0.78);
}

.network-load-separator {
  width: 1px;
  height: 12px;
  background: rgba(255, 255, 255, 0.08);
}

@keyframes networkPulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.95; }
}

@media (max-width: 460px) {
  .network-load-badge {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }
}
</style>
