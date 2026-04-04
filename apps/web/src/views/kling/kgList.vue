<script setup lang="ts">
import { LazyImg, Waterfall } from 'vue-waterfall-plugin-next'
import 'vue-waterfall-plugin-next/dist/style.css'

import { KlingTask, klingStore } from '@/api/klingStore'
import { nextTick, ref, watch } from 'vue'
import { NEmpty, NButton, NPopover, NButtonGroup, NSpin, NImage, NPopconfirm, useMessage } from 'naive-ui'
import { ViewCard } from 'vue-waterfall-plugin-next/dist/types/types/waterfall'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { homeStore } from '@/store'
import { klingFeed } from '@/api/kling'
import { mlog } from '@/api'
import { SvgIcon } from '@/components/common'
import { t } from '@/locales'
import KgImage from './kgImage.vue'

const list = ref<KlingTask[]>([])
const list2 = ref<ViewCard[]>([])

const st = ref({ show: true, showImg: '', isLoad: false, pIndex: -1, isStart: true })
const csuno = new klingStore()
const ms = useMessage()

const initLoad = () => {
  const arr = csuno.getObjs()
  list.value = arr.reverse()
  toList2()
}

const toList2 = () => {
  list2.value = list.value.map((v, k) => {
    const url = v.data.task_result?.images?.[0]?.url || v.data.task_result?.videos?.[0]?.url || ''
    return { url, id: v.request_id, index: k, src: url, isLoad: 0, task: v }
  })
}

const breakpoints = {
  2000: { rowPerView: 6 },
  1600: { rowPerView: 5 },
  1200: { rowPerView: 4 },
  800: { rowPerView: 3 },
  500: { rowPerView: 2 },
}

const { isMobile } = useBasicLayout()
const showImg = ref<typeof NImage>()

const goShow = (item: any) => {
  if (isMobile.value) return
  st.value.show = true
  st.value.showImg = item.url
  nextTick(() => showImg.value?.click())
}

const goShow2 = (item: any) => {
  if (isMobile.value) return
  st.value.show = true
  st.value.showImg = (item.base64 ? item.base64 : item.src) as string
  nextTick(() => showImg.value?.click())
}

initLoad()

watch(() => homeStore.myData.act, (n) => {
  if (n === 'KlingFeed') {
    st.value.isStart = false
    initLoad()
  }
})

const getFeed = (item: any) => {
  mlog('item', item)
  klingFeed(item.task.data.task_id, item.task.cat, item.task.prompt)
}

const deleteGo = (item: any) => {
  mlog('deleteGo', item)
  if (csuno.delete(item.id)) {
    ms.success(t('common.deleteSuccess'))
    initLoad()
  }
}
</script>

<template>
  <!-- Waterfall list -->
  <div v-if="list2.length > 0" class="kg-list-wrap px-3 py-4">
    <Waterfall
      :list="list2"
      :breakpoints="breakpoints"
      :gutter="12"
      background="transparent"
    >
      <template #item="{ item, index }">
        <!-- ========== CARD ========== -->
        <div
          class="kg-card group rounded-2xl overflow-hidden bg-white/5 backdrop-blur-sm border border-white/10 relative"
          :class="{
            'kg-card--processing': !item.url && item.task.data.task_status !== 'failed' && item.task.data.task_status !== 'succeed',
            'kg-card--completed': item.url || item.task.data.task_status === 'succeed',
            'kg-card--failed': item.task.data.task_status === 'failed',
          }"
          :style="{ animationDelay: `${index * 45}ms` }"
          @mouseenter="st.pIndex = index"
          @mouseleave="st.pIndex = -1"
        >

          <!-- Status accent strip (left border) -->
          <div class="kg-status-strip" />

          <!-- Status badge (top-left) -->
          <div
            class="kg-status-badge absolute top-2 left-2 z-20 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-md border"
            :class="{
              'bg-violet-500/20 text-violet-300 border-violet-400/30 kg-badge-pulse': !item.url && item.task.data.task_status !== 'failed' && item.task.data.task_status !== 'succeed',
              'bg-emerald-500/20 text-emerald-300 border-emerald-400/30': item.url || item.task.data.task_status === 'succeed',
              'bg-red-500/20 text-red-300 border-red-400/30': item.task.data.task_status === 'failed',
            }"
          >
            <span
              class="w-1.5 h-1.5 rounded-full"
              :class="{
                'bg-violet-400 kg-dot-pulse': !item.url && item.task.data.task_status !== 'failed' && item.task.data.task_status !== 'succeed',
                'bg-emerald-400': item.url || item.task.data.task_status === 'succeed',
                'bg-red-400': item.task.data.task_status === 'failed',
              }"
            />
            <span v-if="item.task.data.task_status === 'failed'">失败</span>
            <span v-else-if="item.url || item.task.data.task_status === 'succeed'">已完成</span>
            <span v-else>处理中</span>
          </div>

          <!-- ===== VIDEO CARD ===== -->
          <template v-if="item.task.cat !== 'image'">
            <div class="relative w-full overflow-hidden" style="min-height: 140px;">

              <!-- Video element (src only injected on hover to avoid preload spam) -->
              <video
                v-if="item.url"
                loop
                playsinline
                referrerpolicy="no-referrer"
                :poster="item.url"
                class="kg-video w-full h-full object-cover block"
                :autoplay="st.pIndex === index"
                :controls="st.pIndex === index"
              >
                <source
                  v-if="st.pIndex === index"
                  :src="item.url"
                  type="video/mp4"
                  referrerpolicy="no-referrer"
                />
              </video>

              <!-- Bottom gradient for text contrast -->
              <div class="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none" />

              <!-- Enhanced play button overlay -->
              <transition name="fade-overlay">
                <div
                  v-if="item.url && st.pIndex !== index"
                  class="absolute inset-0 flex items-center justify-center"
                >
                  <div class="play-circle-enhanced">
                    <div class="play-circle-ring" />
                    <SvgIcon icon="mdi:play" class="text-2xl text-white ml-0.5 relative z-10" />
                  </div>
                </div>
              </transition>

              <!-- Download button with label on hover -->
              <transition name="fade-actions">
                <a
                  v-if="item.url && st.pIndex === index"
                  :href="item.url"
                  target="_blank"
                  rel="noreferrer"
                  download
                  class="kg-download-btn action-btn absolute top-2 right-2 flex items-center gap-1.5 h-8 rounded-full bg-black/55 backdrop-blur-md border border-white/15 px-2.5 text-white/80 hover:text-white hover:bg-black/75 transition-all duration-200"
                  :title="$t('video.download')"
                >
                  <SvgIcon icon="mdi:download" class="text-base flex-shrink-0" />
                  <span class="kg-download-label text-[11px] font-medium whitespace-nowrap">{{ $t('video.download') }}</span>
                </a>
              </transition>

              <!-- ---- Failed state ---- -->
              <div
                v-if="!item.url && item.task.data.task_status === 'failed'"
                class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 bg-red-900/20"
              >
                <SvgIcon icon="mdi:alert-circle-outline" class="text-3xl text-red-400 error-pulse" />
                <div class="text-xs text-white/45 mt-1 truncate max-w-full px-2">
                  ID: {{ item.task.data.task_id }}
                </div>
              </div>

              <!-- ---- Loading / Processing state with progress ring ---- -->
              <div
                v-else-if="!item.url && item.task.data.task_status !== 'failed' && item.task.data.task_status !== 'succeed'"
                class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-3"
              >
                <!-- Shimmer skeleton overlay -->
                <div class="shimmer-skeleton absolute inset-0 rounded-2xl" />
                <!-- Circular progress ring -->
                <div class="kg-progress-ring relative z-10">
                  <svg class="kg-ring-svg" width="52" height="52" viewBox="0 0 52 52">
                    <circle class="kg-ring-track" cx="26" cy="26" r="22" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="3" />
                    <circle class="kg-ring-progress" cx="26" cy="26" r="22" fill="none" stroke="url(#kg-ring-grad)" stroke-width="3" stroke-linecap="round" stroke-dasharray="138.2" stroke-dashoffset="34.5" />
                    <defs>
                      <linearGradient id="kg-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="rgba(139,92,246,1)" />
                        <stop offset="100%" stop-color="rgba(99,102,241,1)" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div class="absolute inset-0 flex items-center justify-center">
                    <SvgIcon icon="mdi:creation" class="text-lg text-violet-300 breathe" />
                  </div>
                </div>
                <span class="relative z-10 text-xs text-white/60 breathe">
                  {{ item.task.data.task_status || $t('video.process') }}
                </span>
              </div>

              <!-- ---- Retry state ---- -->
              <div
                v-else-if="!item.url && item.task.data.task_status === 'succeed'"
                class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3"
              >
                <SvgIcon icon="mdi:refresh" class="text-2xl text-violet-300" />
                <NButton size="small" type="primary" ghost @click="getFeed(item)">
                  {{ $t('video.repeat2') }}
                </NButton>
              </div>
            </div>
          </template>

          <!-- ===== IMAGE CARD ===== -->
          <template v-else>
            <div class="relative overflow-hidden kg-img-wrap">
              <KgImage
                :item="item"
                class="kg-img-inner"
                @click="goShow2(item)"
              />
            </div>
          </template>

          <!-- ===== TASK INFO BAR ===== -->
          <div class="kg-info-bar flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border-t border-white/[0.06]">
            <!-- Task type badge -->
            <span class="kg-type-badge inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-500/15 text-violet-300/90 border border-violet-400/15">
              <SvgIcon
                :icon="item.task.cat === 'image' ? 'ri:image-line' : (item.task.cat === 'video_from_image' || item.task.cat === 'i2v' ? 'ri:image-2-line' : 'ri:video-line')"
                class="text-[11px]"
              />
              <span v-if="item.task.cat === 'image'">文生图</span>
              <span v-else-if="item.task.cat === 'video_from_image' || item.task.cat === 'i2v'">图生视频</span>
              <span v-else>文生视频</span>
            </span>
            <!-- Model version -->
            <span
              v-if="item.task.data.model_version || item.task.data.model_name || item.task.data.model"
              class="text-[10px] text-white/30 truncate"
            >
              {{ item.task.data.model_version || item.task.data.model_name || item.task.data.model }}
            </span>
            <!-- Duration -->
            <span
              v-if="item.task.data.duration || item.task.data.task_result?.videos?.[0]?.duration"
              class="text-[10px] text-white/30 ml-auto flex-shrink-0"
            >
              {{ item.task.data.duration || item.task.data.task_result?.videos?.[0]?.duration }}s
            </span>
          </div>

          <!-- ===== PROMPT OVERLAY (bottom, group-hover) ===== -->
          <div class="prompt-overlay absolute inset-x-0 bottom-0 px-3 py-2 flex items-end gap-2 bg-gradient-to-t from-black/75 via-black/40 to-transparent backdrop-blur-[2px]">
            <div class="flex-1 min-w-0">
              <p class="text-[13px] text-white/90 line-clamp-2 leading-snug">
                {{ item.task.prompt || item.task.data?.task_id }}
              </p>
            </div>
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <!-- Download (video only) -->
              <a
                v-if="item.url && item.task.cat !== 'image'"
                :href="item.url"
                target="_blank"
                rel="noreferrer"
                download
                class="action-btn w-7 h-7 rounded-full bg-black/50 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white/70 hover:text-white hover:bg-black/70 transition-all duration-150"
                :title="$t('video.download')"
              >
                <SvgIcon icon="mdi:download" class="text-sm" />
              </a>
              <!-- Delete -->
              <NPopconfirm @positive-click="() => deleteGo(item)" placement="top">
                <template #trigger>
                  <button
                    class="action-btn w-7 h-7 rounded-full bg-black/50 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white/70 hover:text-red-400 hover:bg-black/70 transition-all duration-150"
                    :title="$t('mj.confirmDelete')"
                  >
                    <SvgIcon icon="mdi:delete" class="text-sm" />
                  </button>
                </template>
                {{ $t('mj.confirmDelete') }}
              </NPopconfirm>
            </div>
          </div>

        </div>
        <!-- ========== END CARD ========== -->
      </template>
    </Waterfall>
  </div>

  <!-- ===== EMPTY STATE ===== -->
  <div v-else class="w-full h-full flex flex-col items-center justify-center gap-5 py-20">
    <div class="empty-icon-wrap w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-600/20 to-indigo-600/10 border border-violet-500/20 flex items-center justify-center">
      <SvgIcon icon="ri:image-add-line" class="text-4xl text-violet-400/70" />
    </div>
    <div class="text-center">
      <div class="text-sm font-medium text-white/50">{{ $t('video.nodata') }}</div>
      <div class="text-xs text-white/25 mt-1">Generated images and videos will appear here</div>
    </div>
  </div>

  <!-- Hidden NImage for fullscreen preview -->
  <NImage
    ref="showImg"
    :src="st.showImg"
    class="hidden"
    preview-disabled
    :show-toolbar="false"
  />
</template>

<style scoped>
/* ── Card entrance ── */
.kg-card {
  animation: cardFadeIn 0.35s ease both;
  transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
}
.kg-card:hover {
  transform: scale(1.03);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(139, 92, 246, 0.3),
    0 0 20px rgba(139, 92, 246, 0.15),
    0 0 40px rgba(99, 102, 241, 0.08);
  border-color: rgba(139, 92, 246, 0.35);
}
@keyframes cardFadeIn {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    }
}

/* ── Status accent strip (left border) ── */
.kg-status-strip {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 4px;
  z-index: 15;
  border-radius: 8px 0 0 8px;
  transition: opacity 0.3s ease, box-shadow 0.3s ease;
}
.kg-card--processing .kg-status-strip {
  background: linear-gradient(180deg, rgba(139,92,246,0.8), rgba(99,102,241,0.6));
  box-shadow: 0 0 8px rgba(139,92,246,0.4);
  animation: stripPulse 2s ease-in-out infinite;
}
.kg-card--completed .kg-status-strip {
  background: linear-gradient(180deg, rgba(52,211,153,0.7), rgba(16,185,129,0.4));
  box-shadow: 0 0 6px rgba(52,211,153,0.2);
}
.kg-card--failed .kg-status-strip {
  background: linear-gradient(180deg, rgba(248,113,113,0.8), rgba(220,38,38,0.5));
  box-shadow: 0 0 6px rgba(248,113,113,0.3);
}
.kg-card:hover .kg-status-strip {
  box-shadow: 0 0 14px rgba(139,92,246,0.5);
}
.kg-card--completed:hover .kg-status-strip {
  box-shadow: 0 0 14px rgba(52,211,153,0.4);
}
.kg-card--failed:hover .kg-status-strip {
  box-shadow: 0 0 14px rgba(248,113,113,0.4);
}
@keyframes stripPulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.5; }
}

/* ── Status badge ── */
.kg-status-badge {
  transition: opacity 0.25s ease;
}
.kg-badge-pulse {
  animation: badgePulse 2.4s ease-in-out infinite;
}
@keyframes badgePulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(139,92,246,0); }
  50%      { box-shadow: 0 0 8px 2px rgba(139,92,246,0.25); }
}
.kg-dot-pulse {
  animation: dotPulse 1.4s ease-in-out infinite;
}
@keyframes dotPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(0.7); }
}

/* ── Enhanced play button ── */
.play-circle-enhanced {
  position: relative;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(139,92,246,0.6), rgba(99,102,241,0.5));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;
  box-shadow: 0 4px 16px rgba(139,92,246,0.3), inset 0 1px 0 rgba(255,255,255,0.15);
}
.play-circle-enhanced:hover,
.kg-card:hover .play-circle-enhanced {
  transform: scale(1.15);
  box-shadow: 0 6px 24px rgba(139,92,246,0.45), inset 0 1px 0 rgba(255,255,255,0.2);
  background: linear-gradient(135deg, rgba(139,92,246,0.75), rgba(99,102,241,0.65));
}
.play-circle-ring {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid rgba(139,92,246,0.25);
  animation: ringPulse 2.5s ease-in-out infinite;
}
@keyframes ringPulse {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50%      { transform: scale(1.08); opacity: 0; }
}

/* ── Download button with expanding label ── */
.kg-download-btn {
  overflow: hidden;
}
.kg-download-label {
  max-width: 0;
  opacity: 0;
  transition: max-width 0.25s ease, opacity 0.2s ease;
}
.kg-download-btn:hover .kg-download-label {
  max-width: 80px;
  opacity: 1;
}

/* ── Task info bar ── */
.kg-info-bar {
  min-height: 26px;
}
.kg-type-badge {
  letter-spacing: 0.02em;
}

/* ── Circular progress ring ── */
.kg-progress-ring {
  position: relative;
  width: 52px;
  height: 52px;
}
.kg-ring-svg {
  animation: ringRotate 2.4s linear infinite;
}
@keyframes ringRotate {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
.kg-ring-progress {
  filter: drop-shadow(0 0 4px rgba(139,92,246,0.5));
}

/* ── Video ── */
.kg-video {
  display: block;
  min-height: 140px;
  transition: transform 0.3s ease;
}

/* ── Image zoom ── */
.kg-img-wrap {
  cursor: pointer;
}
.kg-img-inner {
  transition: transform 0.3s ease;
}
.kg-card:hover .kg-img-inner {
  transform: scale(1.05);
}

/* ── Prompt overlay: always invisible, visible on group hover ── */
.prompt-overlay {
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.25s ease, transform 0.25s ease;
  pointer-events: none;
}
.kg-card:hover .prompt-overlay {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

/* ── Action buttons ── */
.action-btn {
  outline: none;
  cursor: pointer;
  text-decoration: none;
}

/* ── Shimmer skeleton ── */
.shimmer-skeleton {
  background: linear-gradient(
    90deg,
    rgba(255,255,255,0.04) 0%,
    rgba(255,255,255,0.10) 40%,
    rgba(255,255,255,0.04) 80%
  );
  background-size: 200% 100%;
  animation: shimmer 1.6s linear infinite;
}
@keyframes shimmer {
  from { background-position: 200% center; }
  to   { background-position: -200% center; }
}

/* ── Breathing opacity for status text ── */
.breathe {
  animation: breatheOpacity 2s ease-in-out infinite;
}
@keyframes breatheOpacity {
  0%, 100% { opacity: 0.6; }
  50%       { opacity: 1;   }
}

/* ── Error pulse ── */
.error-pulse {
  animation: errorPulse 1.8s ease-in-out infinite;
}
@keyframes errorPulse {
  0%, 100% { opacity: 1;   transform: scale(1);    }
  50%       { opacity: 0.5; transform: scale(0.88); }
}

/* ── Empty state float ── */
.empty-icon-wrap {
  animation: floatIdle 3.2s ease-in-out infinite;
}
@keyframes floatIdle {
  0%, 100% { transform: translateY(0);   }
  50%       { transform: translateY(-7px); }
}

/* ── Fade overlay transition (play button) ── */
.fade-overlay-enter-active,
.fade-overlay-leave-active {
  transition: opacity 0.22s ease;
}
.fade-overlay-enter-from,
.fade-overlay-leave-to {
  opacity: 0;
}

/* ── Fade actions transition (download btn) ── */
.fade-actions-enter-active,
.fade-actions-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.fade-actions-enter-from,
.fade-actions-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
