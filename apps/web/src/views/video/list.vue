<script setup lang="ts">
import { LazyImg, Waterfall } from 'vue-waterfall-plugin-next'
import 'vue-waterfall-plugin-next/dist/style.css'
import { ViewCard } from 'vue-waterfall-plugin-next/dist/types/types/waterfall';

import { mlog } from '@/api';
import { DtoItem, DtoStore } from '@/api/dtoStore';
import { onMounted, ref, watch } from 'vue';
import { NEmpty,NButton, useMessage, NPopconfirm,NPopover} from "naive-ui"
import{ DtoFeed, breakpoints } from './veo'
import { t } from '@/locales';
import { SvgIcon } from '@/components/common';
import { homeStore } from '@/store';

const csuno= new DtoStore()
const list= ref<DtoItem[]>([]);
const list2= ref<ViewCard[]>([]);
const st=ref({show:false,showImg:'' ,isLoad:false,pIndex:-1,isStart:true });

const ms= useMessage()
const initLoad=()=>{

    let arr = csuno.getObjs();
    mlog("initLoad List", arr);
    list.value= arr.reverse()

    list2.value= list.value.map((v,k )=>{
        let url= v.url??''
        return { url , id: v.id,  index: k, src: url ,isLoad:0,task:v }
    })
}

const getFeed=(item:ViewCard)=>{
     DtoFeed(item.task)
}


onMounted(()=>{
   initLoad()
})
watch(()=>homeStore.myData.act, (n)=>{
     if(n=='dtoFeed') {
        st.value.isStart= false;
        initLoad()
     }
});

const deleteGo=(item:any)=>{
    mlog('deleteGo',item )
    if( csuno.delete( item.id)){
        ms.success( t('common.deleteSuccess'))
        initLoad()
    }
}
</script>

<template>
  <!-- Grid list -->
  <div v-if="list.length > 0" class="vl-wrap px-3 py-4">
    <Waterfall :list="list2" :breakpoints="breakpoints" :gutter="12" background="transparent" v-if="list2.length">
      <template #item="{ item, url, index }">
        <!-- ========== CARD ========== -->
        <div
          class="vl-card group rounded-2xl overflow-hidden bg-white/5 backdrop-blur-sm border border-white/10 relative"
          :style="{ animationDelay: `${index * 45}ms` }"
          @mouseenter="st.pIndex = index"
          @mouseleave="st.pIndex = -1"
        >

          <!-- ---- FAILED ---- -->
          <div v-if="'failed' === item.task.status"
            class="w-full flex flex-col items-center justify-center gap-2 p-4"
            style="min-height: 180px;"
          >
            <SvgIcon icon="mdi:alert-circle-outline" class="text-3xl text-red-400 error-pulse" />
            <span class="text-xs text-white/50">{{ t('video.failed') }}</span>
            <span class="text-[11px] text-white/30 truncate max-w-full">ID: {{ item.task.mid }}</span>
          </div>

          <!-- ---- NEEDS FEED (stale > 20s, no src) ---- -->
          <template v-else-if="((new Date().getTime()) / 1000 - item.task.last_feed) > 20 && !item.src">
            <div class="w-full flex flex-col items-center justify-center gap-3 p-4" style="min-height: 180px;">
              <SvgIcon icon="mdi:refresh" class="text-2xl text-violet-300" />
              <NButton size="small" type="primary" ghost @click="getFeed(item)">{{ $t('video.repeat') }}</NButton>
              <span class="text-[11px] text-white/30 truncate max-w-full">ID: {{ item.task.mid }}</span>
            </div>
          </template>

          <!-- ---- PROCESSING (no src) ---- -->
          <template v-else-if="!item.src">
            <div class="w-full flex flex-col items-center justify-center gap-3 p-4 relative" style="min-height: 180px;">
              <div class="shimmer-skeleton absolute inset-0 rounded-2xl" />
              <div class="status-badge processing-badge flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium relative z-10">
                <span class="processing-dot" />
                {{ item.task.status }}
              </div>
              <span class="relative z-10 text-[11px] text-white/30 truncate max-w-full">ID: {{ item.task.mid }}</span>
            </div>
          </template>

          <!-- ---- HAS VIDEO ---- -->
          <template v-else>
            <div v-if="item.task.type === 'video' && item.src" class="relative w-full overflow-hidden" style="min-height: 140px;">
              <video
                :src="item.src"
                loop
                playsinline
                disableremoteplayback
                disablepictureinpicture
                referrerpolicy="no-referrer"
                class="vl-video w-full h-full object-cover block"
                :controls="st.pIndex === index"
              />

              <!-- Bottom gradient -->
              <div class="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none" />

              <!-- Play button overlay -->
              <transition name="fade-overlay">
                <div
                  v-if="st.pIndex !== index"
                  class="absolute inset-0 flex items-center justify-center"
                >
                  <div class="play-circle w-12 h-12 rounded-full bg-black/50 backdrop-blur-sm border border-white/25 flex items-center justify-center">
                    <SvgIcon icon="mdi:play" class="text-2xl text-white ml-0.5" />
                  </div>
                </div>
              </transition>

              <!-- Download button (top-right, on hover) -->
              <transition name="fade-actions">
                <a
                  v-if="st.pIndex === index"
                  target="_blank"
                  :href="item.src"
                  rel="noreferrer"
                  download
                  class="action-btn absolute top-2 right-2 w-8 h-8 rounded-full bg-black/55 backdrop-blur-md border border-white/15 flex items-center justify-center text-white/80 hover:text-white hover:bg-black/75 transition-all duration-150"
                  :title="$t('video.download')"
                >
                  <SvgIcon icon="mdi:download" class="text-base" />
                </a>
              </transition>
            </div>
          </template>

          <!-- ===== PROMPT OVERLAY (bottom, group-hover) ===== -->
          <div class="prompt-overlay absolute inset-x-0 bottom-0 px-3 py-2 flex items-end gap-2 bg-gradient-to-t from-black/75 via-black/40 to-transparent backdrop-blur-[2px]">
            <div class="flex-1 min-w-0">
              <n-popover trigger="hover">
                <template #trigger>
                  <p class="text-[13px] text-white/90 line-clamp-2 leading-snug cursor-default">
                    <template v-if="item.task.title">{{ item.task.title }}</template>
                  </p>
                </template>
                <div class="text-xs space-y-1 max-w-[300px]">
                  <div>Model: {{ item.task.model }}</div>
                  <div>Platform: {{ item.task.plat }}</div>
                  <div>ID: {{ item.task.id }}</div>
                </div>
              </n-popover>
            </div>
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <n-popconfirm @positive-click="() => deleteGo(item)" placement="top">
                <template #trigger>
                  <button
                    class="action-btn w-7 h-7 rounded-full bg-black/50 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white/70 hover:text-red-400 hover:bg-black/70 transition-all duration-150"
                    :title="$t('mj.confirmDelete')"
                  >
                    <SvgIcon icon="mdi:delete" class="text-sm" />
                  </button>
                </template>
                {{ $t('mj.confirmDelete') }}
              </n-popconfirm>
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
      <SvgIcon icon="ri:video-add-line" class="text-4xl text-violet-400/70" />
    </div>
    <div class="text-center">
      <div class="text-sm font-medium text-white/50">{{ $t('video.nodata') }}</div>
      <div class="text-xs text-white/25 mt-1">Generated videos will appear here</div>
    </div>
  </div>
</template>

<style scoped>
/* ── Card entrance ── */
.vl-card {
  animation: cardFadeIn 0.35s ease both;
  transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
}
.vl-card:hover {
  transform: scale(1.03);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(139, 92, 246, 0.25), 0 0 16px rgba(99, 102, 241, 0.12);
  border-color: rgba(255, 255, 255, 0.22);
}
@keyframes cardFadeIn {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    }
}

/* ── Video ── */
.vl-video {
  display: block;
  min-height: 140px;
  transition: transform 0.3s ease;
}

/* ── Play circle ── */
.play-circle {
  transition: transform 0.2s ease, background 0.2s ease;
}
.vl-card:hover .play-circle {
  transform: scale(1.12);
}

/* ── Prompt overlay ── */
.prompt-overlay {
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.25s ease, transform 0.25s ease;
  pointer-events: none;
}
.vl-card:hover .prompt-overlay {
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

/* ── Processing badge ── */
.processing-badge {
  background: rgba(139,92,246,0.18);
  border: 1px solid rgba(139,92,246,0.35);
  color: #c4b5fd;
  backdrop-filter: blur(8px);
}
.processing-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #a78bfa;
  animation: dotPulse 1.4s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes dotPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(0.7); }
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

/* ── Fade overlay transition ── */
.fade-overlay-enter-active,
.fade-overlay-leave-active {
  transition: opacity 0.22s ease;
}
.fade-overlay-enter-from,
.fade-overlay-leave-to {
  opacity: 0;
}

/* ── Fade actions transition ── */
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
