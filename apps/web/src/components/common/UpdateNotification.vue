<script setup lang="ts">
import { ref } from 'vue'
import { NModal, NCard, NButton, NTag, NTimeline, NTimelineItem } from 'naive-ui'
import type { VersionInfo } from '@/utils/versionCheck'
import { dismissVersion } from '@/utils/versionCheck'

const show = ref(false)
const versionInfo = ref<VersionInfo | null>(null)

function open(info: VersionInfo) {
  versionInfo.value = info
  show.value = true
}

function handleClose() {
  if (versionInfo.value) {
    dismissVersion(versionInfo.value.version)
  }
  show.value = false
}

function handleRefresh() {
  if (versionInfo.value) {
    dismissVersion(versionInfo.value.version)
  }
  window.location.reload()
}

defineExpose({ open })
</script>

<template>
  <NModal v-model:show="show" :mask-closable="false">
    <NCard
      style="width: 420px; max-width: 90vw; border-radius: 12px;"
      :bordered="false"
      role="dialog"
    >
      <template #header>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 20px;">&#127881;</span>
          <span>版本更新</span>
          <NTag v-if="versionInfo" type="success" size="small" round>
            v{{ versionInfo.version }}
          </NTag>
        </div>
      </template>
      <div v-if="versionInfo" style="max-height: 300px; overflow-y: auto;">
        <NTimeline>
          <NTimelineItem
            v-for="(item, idx) in versionInfo.changelog"
            :key="idx"
            type="success"
            :content="item"
          />
        </NTimeline>
      </div>
      <template #action>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <NButton @click="handleClose">我知道了</NButton>
          <NButton type="primary" @click="handleRefresh">刷新页面</NButton>
        </div>
      </template>
    </NCard>
  </NModal>
</template>
