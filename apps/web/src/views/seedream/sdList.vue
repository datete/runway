<script setup lang="ts">
import { Waterfall } from 'vue-waterfall-plugin-next'
import 'vue-waterfall-plugin-next/dist/style.css'
import { SeedreamTask, seedreamStore } from '@/api/seedreamStore'
import { seedreamFetchList, seedreamRefreshOne } from '@/api/seedream'
import { ref, watch } from 'vue'
import { NImage, NImageGroup, NPopconfirm, useMessage } from 'naive-ui'
import { ViewCard } from 'vue-waterfall-plugin-next/dist/types/types/waterfall'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { homeStore } from '@/store'
import { mlog } from '@/api'
import { SvgIcon } from '@/components/common'

interface SdImg { url: string; index: number }
interface SdTaskCard extends ViewCard {
  id: string
  task: SeedreamTask
  images: SdImg[]
  status: 'pending' | 'succeed' | 'failed'
  src: string
}

const list = ref<SeedreamTask[]>([])
const list2 = ref<SdTaskCard[]>([])
const csuno = new seedreamStore()
const ms = useMessage()
const { isMobile } = useBasicLayout()

const initLoad = async () => {
  const arr = csuno.getObjs()
  list.value = arr.slice().reverse()
  toList2()
  try {
    const remote = await seedreamFetchList()
    list.value = remote
    toList2()
    remote.filter(t => t.data.task_status === 'pending').forEach(t => pollOne(t.data.task_id))
  } catch (e) { mlog('seedream list err', e) }
}

const pollOne = async (id: string) => {
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 4000))
    const t = await seedreamRefreshOne(id)
    if (!t) return
    if (t.data.task_status !== 'pending') { initLoad(); return }
  }
}

const toList2 = () => {
  list2.value = list.value.map((task, idx): SdTaskCard => {
    const imgs = (task.data.task_result?.images || []).map((im: any, i: number) => ({
      url: im.url || im,
      index: i,
    }))
    const status = task.data.task_status as any
    return {
      id: task.request_id || String(idx),
      task,
      images: imgs,
      status,
      src: imgs[0]?.url || '',
      index: idx,
      isLoad: 0,
    } as any
  })
}

const breakpoints = {
  2000: { rowPerView: 4 },
  1600: { rowPerView: 3 },
  1200: { rowPerView: 3 },
  800:  { rowPerView: 2 },
  500:  { rowPerView: 1 },
}

const gridClass = (n: number) => {
  if (n <= 1) return 'sd-grid-1'
  if (n === 2) return 'sd-grid-2'
  if (n === 3) return 'sd-grid-3'
  return 'sd-grid-4'
}

const downloadImg = (url: string) => {
  if (!url) return
  const a = document.createElement('a')
  a.href = url; a.target = '_blank'; a.rel = 'noreferrer'; a.download = ''
  a.click()
}

const downloadAll = (card: SdTaskCard) => {
  card.images.forEach((im, i) => setTimeout(() => downloadImg(im.url), i * 250))
}

const deleteGo = (card: SdTaskCard) => {
  if (csuno.delete(card.task.request_id)) { ms.success('已删除'); initLoad() }
}

const typeLabel = (task: SeedreamTask) => {
  const hasRef = Array.isArray((task as any).referenceImages) && (task as any).referenceImages.length > 0
  return hasRef ? '图生图' : '文生图'
}

initLoad()
watch(() => homeStore.myData.act, (n) => { if (n === 'SeedreamFeed') initLoad() })
</script>

<template>
  <div v-if="list2.length > 0" class="sd-list-wrap px-3 py-4">
    <Waterfall
      :list="list2"
      :breakpoints="breakpoints"
      :gutter="14"
      background="transparent"
    >
      <template #item="{ item, index }">
        <div
          class="sd-card group rounded-2xl overflow-hidden bg-white/5 backdrop-blur-sm border border-white/10 relative"
          :class="{
            'sd-card--processing': item.status === 'pending',
            'sd-card--completed': item.status === 'succeed',
            'sd-card--failed': item.status === 'failed',
          }"
          :style="{ animationDelay: `${index * 45}ms` }"
        >
          <div class="sd-status-strip" />

          <div class="flex items-center justify-between px-3 pt-2.5 pb-2 gap-2">
            <div
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-md border"
              :class="{
                'bg-violet-500/20 text-violet-300 border-violet-400/30 sd-badge-pulse': item.status === 'pending',
                'bg-emerald-500/20 text-emerald-300 border-emerald-400/30': item.status === 'succeed',
                'bg-red-500/20 text-red-300 border-red-400/30': item.status === 'failed',
              }"
            >
              <span
                class="w-1.5 h-1.5 rounded-full"
                :class="{
                  'bg-violet-400 sd-dot-pulse': item.status === 'pending',
                  'bg-emerald-400': item.status === 'succeed',
                  'bg-red-400': item.status === 'failed',
                }"
              />
              <span v-if="item.status === 'pending'">处理中</span>
              <span v-else-if="item.status === 'failed'">失败</span>
              <span v-else>已完成</span>
            </div>

            <div class="flex items-center gap-1.5 text-[10px] text-white/40">
              <span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/5 border border-white/10">
                <SvgIcon icon="ri:image-line" class="text-[11px]" />
                {{ typeLabel(item.task) }}
              </span>
              <span v-if="item.images.length > 1" class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/5 border border-white/10">
                ×{{ item.images.length }}
              </span>
              <span v-if="item.task.size" class="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">
                {{ item.task.size }}
              </span>
            </div>
          </div>

          <div class="sd-media relative px-3">
            <NImageGroup v-if="item.status === 'succeed' && item.images.length > 0" show-toolbar-tooltip>
              <div class="sd-grid" :class="gridClass(item.images.length)">
                <div
                  v-for="img in item.images"
                  :key="img.index"
                  class="sd-tile relative overflow-hidden rounded-xl bg-black/20 border border-white/5"
                >
                  <NImage
                    :src="img.url"
                    object-fit="cover"
                    :img-props="{ style: 'width:100%;height:100%;object-fit:cover;display:block;' }"
                  />
                  <button
                    class="sd-tile-dl absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 backdrop-blur text-white/80 flex items-center justify-center opacity-0 hover:bg-black/80 hover:text-white transition"
                    title="下载"
                    @click.stop="downloadImg(img.url)"
                  >
                    <SvgIcon icon="mdi:download" class="text-xs" />
                  </button>
                </div>
              </div>
            </NImageGroup>

            <div v-else-if="item.status === 'pending'" class="sd-placeholder flex flex-col items-center justify-center gap-3 rounded-xl relative overflow-hidden" style="min-height:180px;">
              <div class="shimmer-skeleton absolute inset-0" />
              <div class="sd-progress-ring relative z-10">
                <svg class="sd-ring-svg" width="52" height="52" viewBox="0 0 52 52">
                  <circle cx="26" cy="26" r="22" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="3" />
                  <circle class="sd-ring-progress" cx="26" cy="26" r="22" fill="none" stroke="url(#sd-ring-grad)" stroke-width="3" stroke-linecap="round" stroke-dasharray="138.2" stroke-dashoffset="34.5" />
                  <defs>
                    <linearGradient id="sd-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="rgba(139,92,246,1)" />
                      <stop offset="100%" stop-color="rgba(99,102,241,1)" />
                    </linearGradient>
                  </defs>
                </svg>
                <div class="absolute inset-0 flex items-center justify-center">
                  <SvgIcon icon="mdi:creation" class="text-lg text-violet-300 breathe" />
                </div>
              </div>
              <span class="relative z-10 text-xs text-white/60 breathe">生成中...</span>
            </div>

            <div v-else class="flex flex-col items-center justify-center gap-2 p-6 rounded-xl bg-red-500/5 border border-red-500/15" style="min-height:140px;">
              <SvgIcon icon="mdi:alert-circle-outline" class="text-3xl text-red-400 sd-error-pulse" />
              <p class="text-[11px] text-red-300/70 text-center line-clamp-2">{{ item.task.data.task_status_msg || '生成失败' }}</p>
            </div>
          </div>

          <div class="px-3 pt-2 pb-2.5">
            <p class="text-[12px] leading-snug text-white/75 line-clamp-2 mb-1.5" :title="item.task.prompt">
              {{ item.task.prompt || item.task.data?.task_id }}
            </p>
            <div class="flex items-center gap-1.5 text-[10px] text-white/30">
              <span class="truncate flex-1">{{ item.task.model || 'seedream-5.0' }}</span>
              <button
                v-if="item.status === 'succeed' && item.images.length > 1"
                class="sd-act-btn"
                title="全部下载"
                @click.stop="downloadAll(item)"
              >
                <SvgIcon icon="mdi:download-multiple" />
              </button>
              <button
                v-else-if="item.status === 'succeed'"
                class="sd-act-btn"
                title="下载"
                @click.stop="downloadImg(item.images[0]?.url || '')"
              >
                <SvgIcon icon="mdi:download" />
              </button>
              <NPopconfirm @positive-click="() => deleteGo(item)" placement="top">
                <template #trigger>
                  <button class="sd-act-btn sd-act-btn--danger" title="删除">
                    <SvgIcon icon="mdi:delete" />
                  </button>
                </template>
                确定删除该任务？
              </NPopconfirm>
            </div>
          </div>
        </div>
      </template>
    </Waterfall>
  </div>

  <div v-else class="w-full h-full flex flex-col items-center justify-center gap-5 py-20">
    <div class="empty-icon-wrap w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-600/20 to-indigo-600/10 border border-violet-500/20 flex items-center justify-center">
      <SvgIcon icon="ri:image-add-line" class="text-4xl text-violet-400/70" />
    </div>
    <div class="text-center">
      <div class="text-sm font-medium text-white/50">暂无生成记录</div>
      <div class="text-xs text-white/25 mt-1">使用 Seedream 生成的图片将展示在这里</div>
    </div>
  </div>
</template>

<style scoped>
.sd-card {
  animation: sdCardFadeIn 0.35s ease both;
  transition: transform 0.25s ease, box-shadow 0.3s ease, border-color 0.3s ease;
}
.sd-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(139,92,246,0.25);
  border-color: rgba(139,92,246,0.32);
}
@keyframes sdCardFadeIn {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.sd-status-strip {
  position: absolute; top: 0; left: 0; bottom: 0; width: 3px; z-index: 15;
  border-radius: 8px 0 0 8px;
}
.sd-card--processing .sd-status-strip {
  background: linear-gradient(180deg, rgba(139,92,246,0.85), rgba(99,102,241,0.55));
  box-shadow: 0 0 8px rgba(139,92,246,0.4);
  animation: sdStripPulse 2s ease-in-out infinite;
}
.sd-card--completed .sd-status-strip {
  background: linear-gradient(180deg, rgba(52,211,153,0.75), rgba(16,185,129,0.4));
}
.sd-card--failed .sd-status-strip {
  background: linear-gradient(180deg, rgba(248,113,113,0.85), rgba(220,38,38,0.5));
}
@keyframes sdStripPulse { 0%,100%{opacity:1} 50%{opacity:0.5} }

.sd-badge-pulse { animation: sdBadgePulse 2.4s ease-in-out infinite; }
@keyframes sdBadgePulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(139,92,246,0); }
  50%     { box-shadow: 0 0 8px 2px rgba(139,92,246,0.25); }
}
.sd-dot-pulse { animation: sdDotPulse 1.4s ease-in-out infinite; }
@keyframes sdDotPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.7)} }

.sd-grid { display: grid; gap: 6px; width: 100%; }
.sd-grid-1 { grid-template-columns: 1fr; }
.sd-grid-2 { grid-template-columns: 1fr 1fr; }
.sd-grid-2 .sd-tile { aspect-ratio: 1/1; }
.sd-grid-3 {
  grid-template-columns: 2fr 1fr;
  grid-template-rows: 1fr 1fr;
  aspect-ratio: 3/2;
}
.sd-grid-3 .sd-tile:nth-child(1) { grid-row: span 2; }
.sd-grid-4 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}
.sd-grid-4 .sd-tile { aspect-ratio: 1/1; }

.sd-tile { cursor: zoom-in; transition: transform 0.25s ease; }
.sd-tile :deep(.n-image) { width: 100%; height: 100%; display: block; }
.sd-tile :deep(img) { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.35s ease; }
.sd-tile:hover :deep(img) { transform: scale(1.04); }
.sd-tile:hover .sd-tile-dl { opacity: 1; }

.sd-act-btn {
  width: 22px; height: 22px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.55); cursor: pointer; transition: all 0.15s ease;
}
.sd-act-btn:hover { background: rgba(139,92,246,0.2); color: #fff; border-color: rgba(139,92,246,0.4); }
.sd-act-btn--danger:hover { background: rgba(248,113,113,0.2); border-color: rgba(248,113,113,0.4); color: #fca5a5; }

.shimmer-skeleton {
  background: linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.10) 40%, rgba(255,255,255,0.04) 80%);
  background-size: 200% 100%; animation: sdShimmer 1.6s linear infinite; border-radius: 12px;
}
@keyframes sdShimmer { from{background-position:200% center} to{background-position:-200% center} }
.breathe { animation: sdBreathe 2s ease-in-out infinite; }
@keyframes sdBreathe { 0%,100%{opacity:0.6} 50%{opacity:1} }
.sd-error-pulse { animation: sdErrorPulse 1.8s ease-in-out infinite; }
@keyframes sdErrorPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.88)} }

.empty-icon-wrap { animation: sdFloat 3.2s ease-in-out infinite; }
@keyframes sdFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-7px)} }

.sd-progress-ring { position: relative; width: 52px; height: 52px; }
.sd-ring-svg { animation: sdRingRotate 2.4s linear infinite; }
@keyframes sdRingRotate { from{transform:rotate(0)} to{transform:rotate(360deg)} }
.sd-ring-progress { filter: drop-shadow(0 0 4px rgba(139,92,246,0.5)); }
</style>
