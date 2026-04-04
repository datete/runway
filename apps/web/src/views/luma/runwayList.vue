<script setup lang="ts">
import { RunwayTask, runwayStore } from '@/api/runwayStore';
import { ref, watch } from 'vue';
import {NEmpty ,NButton,NPopover, NButtonGroup, useMessage,NPopconfirm} from "naive-ui"
import {runwayFeed} from "@/api/runway"
import { mlog } from '@/api';
import { homeStore } from '@/store';
import {SvgIcon} from '@/components/common'
import { t } from '@/locales';

const ms= useMessage();
const failedTaskIds = ref(new Set<string>());

const hoveredTaskId = ref('');
const list= ref<RunwayTask[]>([]);
const csuno= new runwayStore()
const initLoad=()=>{
    list.value= [...csuno.getObjs()].reverse()
}
const RunwayTaskDown=(item:RunwayTask)=>{
    mlog("RunwayTaskDown", item)
    if(  !item.artifacts ||  item.artifacts.length==0 ) return;

    const link = document.createElement('a');

    link.href = item.artifacts[0].url ;
    link.download = item.id+".mp4";
    link.target = '_blank';
    link.rel='noreferrer'
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

const extend=  (item:RunwayTask )=>{
    mlog("extend ", item )
    homeStore.setMyData({act:"runway.extend", actData: item  })
}

watch(()=>homeStore.myData.act, (n)=>{
     if(n=='RunwayFeed')  initLoad()
});

const videoError=(item:RunwayTask)=>{
    mlog("videoError", item)
    failedTaskIds.value.add(item.id)
};

const reRunwayFeed= async(id:string)=>{
    await runwayFeed(id)
    failedTaskIds.value.delete(id)
}

const deleteGo=(item:RunwayTask)=>{
    mlog('deleteGo',item )
    if( csuno.delete( item)){
        ms.success( t('common.deleteSuccess'))
        initLoad()
    }
}

const hasArtifact = (item: RunwayTask) => Boolean(item.artifacts?.length && item.artifacts[0].url);
const getPrompt = (item: RunwayTask) => item.options.text_prompt || item.options.gen2Options?.text_prompt || item.name;

initLoad();
</script>

<template>
  <!-- Grid view -->
  <div v-if="list.length > 0" class="p-4">
    <div class="video-grid">
      <div
        v-for="(item, index) in list"
        :key="item.id || index"
        class="video-card rounded-2xl overflow-hidden bg-white/5 border border-white/8 relative"
        :style="{ animationDelay: `${index * 40}ms` }"
        @mouseenter="hoveredTaskId = item.id"
        @mouseleave="hoveredTaskId = ''"
      >
        <!-- Video / status area -->
        <div class="relative aspect-[16/8.85] bg-black/40 overflow-hidden">

          <!-- Has artifact: video -->
          <template v-if="hasArtifact(item)">
            <div v-if="failedTaskIds.has(item.id)" class="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <SvgIcon icon="mdi:alert-circle-outline" class="text-3xl text-red-400" />
              <NButton size="small" type="primary" @click="reRunwayFeed(item.id)">
                {{ $t('video.repeat2') }}
              </NButton>
            </div>
            <video
              v-else
              loop
              playsinline
              referrerpolicy="no-referrer"
              :poster="item.artifacts[0].previewUrls[0]"
              class="w-full h-full object-cover"
              @error="videoError(item)"
            >
              <source
                :src="item.artifacts[0].url"
                referrerpolicy="no-referrer"
                type="video/mp4"
                v-if="hoveredTaskId === item.id"
              />
            </video>

            <!-- Play overlay (shown on hover before video plays) -->
            <transition name="fade-overlay">
              <div
                v-if="hoveredTaskId !== item.id"
                class="absolute inset-0 flex items-center justify-center bg-black/20"
              >
                <div class="play-btn-overlay w-12 h-12 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/20">
                  <SvgIcon icon="mdi:play" class="text-2xl text-white ml-0.5" />
                </div>
              </div>
            </transition>
          </template>

          <!-- No artifact: status states -->
          <div v-else class="absolute inset-0 flex flex-col items-center justify-center p-3 text-center gap-2">

            <!-- FAILED state -->
            <template v-if="item.status === 'FAILED'">
              <div class="status-badge failed-badge flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium">
                <SvgIcon icon="mdi:alert-circle" class="text-sm" />
                {{ $t('video.failed') }}
              </div>
              <div class="line-clamp-2 text-xs text-white/50 max-w-[90%]">{{ item.progressText }}</div>
            </template>

            <!-- Needs feed refresh -->
            <NButton
              v-else-if="!item.last_feed || ((new Date().getTime()) - item.last_feed) > 20 * 1000"
              size="small"
              type="primary"
              @click="runwayFeed(item.id)"
            >
              {{ $t('video.repeat') }}
            </NButton>

            <!-- Processing state -->
            <template v-else>
              <div class="status-badge processing-badge flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium">
                <span class="processing-dot" />
                {{ $t('video.process') }}{{ new Date(item.last_feed).toLocaleString() }}
              </div>
              <div v-if="item.estimatedTimeToStartSeconds && item.estimatedTimeToStartSeconds > 0" class="text-xs text-white/40">
                {{ item.estimatedTimeToStartSeconds.toFixed(1) }}秒后开始执行
              </div>
            </template>
          </div>

          <!-- Progress bar at bottom of card media -->
          <div
            v-if="item.progressRatio && !hasArtifact(item)"
            class="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10"
          >
            <div
              class="h-full bg-gradient-to-r from-violet-500 to-indigo-400 transition-all duration-700"
              :style="{ width: `${(parseFloat(item.progressRatio) * 100).toFixed(0)}%` }"
            />
          </div>

          <!-- Bottom gradient overlay for text readability -->
          <div class="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none" />

          <!-- Floating action buttons (appear on hover) -->
          <transition name="fade-actions">
            <div
              v-if="hoveredTaskId === item.id && hasArtifact(item)"
              class="absolute top-2 right-2 flex items-center gap-1.5"
            >
              <!-- Download -->
              <button
                class="action-btn backdrop-blur-md bg-black/50 border border-white/15 w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-black/70 transition-all duration-150"
                @click="RunwayTaskDown(item)"
                :title="$t('video.download')"
              >
                <SvgIcon icon="mdi:download" class="text-base" />
              </button>

              <!-- Extend -->
              <button
                class="action-btn backdrop-blur-md bg-black/50 border border-white/15 w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:text-violet-300 hover:bg-black/70 transition-all duration-150"
                @click="extend(item)"
                :title="$t('video.extend')"
              >
                <SvgIcon icon="ri:video-add-line" class="text-base" />
              </button>

              <!-- Delete -->
              <n-popconfirm @positive-click="() => deleteGo(item)" placement="bottom">
                <template #trigger>
                  <button
                    class="action-btn backdrop-blur-md bg-black/50 border border-white/15 w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:text-red-400 hover:bg-black/70 transition-all duration-150"
                    :title="$t('mj.confirmDelete')"
                  >
                    <SvgIcon icon="mdi:delete" class="text-base" />
                  </button>
                </template>
                {{ $t('mj.confirmDelete') }}
              </n-popconfirm>
            </div>
          </transition>
        </div>

        <!-- Card footer: prompt text -->
        <div class="px-3 py-2">
          <n-popover trigger="hover">
            <template #trigger>
              <div class="text-xs text-white/60 line-clamp-1 hover:text-white/80 transition-colors duration-150 cursor-default">
                {{ getPrompt(item) }}
              </div>
            </template>
            <div class="text-xs space-y-1 max-w-[300px]">
              <div v-if="item.id">ID: {{ item.id }}</div>
              <div v-if="item.taskType === 'gen3a'">Version: Gen-3</div>
              <div v-if="item.taskType === 'gen3a_turbo'">Version: Gen-3-turbo</div>
              <div v-if="item.taskType === 'gen2'">Version: Gen-2</div>
              <div v-if="item.createdAt">createdAt: {{ new Date(item.createdAt).toLocaleString() }}</div>
              <div>{{ getPrompt(item) }}</div>
            </div>
          </n-popover>
        </div>
      </div>
    </div>
  </div>

  <!-- Empty state -->
  <div v-else class="w-full h-full flex flex-col items-center justify-center gap-4 py-16">
    <div class="empty-icon-wrap w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-600/20 to-indigo-600/10 flex items-center justify-center border border-violet-500/20">
      <SvgIcon icon="ri:video-add-line" class="text-4xl text-violet-400/70" />
    </div>
    <div class="text-center">
      <div class="text-sm font-medium text-white/50">{{ $t('video.nodata') }}</div>
      <div class="text-xs text-white/25 mt-1">Generated videos will appear here</div>
    </div>
  </div>
</template>

<style scoped>
/* Responsive auto-fit grid */
.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1rem;
}

/* Card entrance animation */
.video-card {
  animation: cardFadeIn 0.35s ease both;
  transition: box-shadow 0.25s ease, transform 0.25s ease;
}
.video-card:hover {
  box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(139,92,246,0.15);
  transform: scale(1.02);
}
@keyframes cardFadeIn {
  from { opacity: 0; transform: translateY(10px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}

/* Play button overlay */
.play-btn-overlay {
  transition: transform 0.2s ease, background 0.2s ease;
}
.video-card:hover .play-btn-overlay {
  transform: scale(1.1);
}

/* Status badges */
.status-badge {
  backdrop-filter: blur(8px);
}
.failed-badge {
  background: rgba(239,68,68,0.18);
  border: 1px solid rgba(239,68,68,0.35);
  color: #fca5a5;
}
.processing-badge {
  background: rgba(139,92,246,0.18);
  border: 1px solid rgba(139,92,246,0.35);
  color: #c4b5fd;
}

/* Pulsing dot for processing */
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

/* Action buttons */
.action-btn {
  outline: none;
  cursor: pointer;
}

/* Transition: floating actions */
.fade-actions-enter-active,
.fade-actions-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.fade-actions-enter-from,
.fade-actions-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* Transition: play overlay */
.fade-overlay-enter-active,
.fade-overlay-leave-active {
  transition: opacity 0.2s ease;
}
.fade-overlay-enter-from,
.fade-overlay-leave-to {
  opacity: 0;
}

/* Empty state icon */
.empty-icon-wrap {
  animation: emptyFloat 3s ease-in-out infinite;
}
@keyframes emptyFloat {
  0%, 100% { transform: translateY(0); }
  50%       { transform: translateY(-6px); }
}
</style>
