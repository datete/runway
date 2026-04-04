<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useMessage, NButton, NInput, NTag, NSelect } from 'naive-ui'
import { clearImageBase64, mlog, upImg } from '@/api'
import { homeStore } from '@/store'
import { klingFeed, klingFetch } from '@/api/kling'
import { t } from '@/locales'
import { SvgIcon } from '@/components/common'

const f = ref({ prompt: '', negative_prompt: '', image: '', image_tail: '', aspect_ratio: '1:1', mode: 'std', duration: '5', model: 'kling-v1-6' })
const st = ref({ bili: 0, isLoading: false, camera_type: '' })

const fsRef = ref()
const fsRef2 = ref()
const ms = useMessage()

const vf = [
  { s: 'width: 100%; height: 100%;', label: '1:1', value: '1:1' },
  { s: 'width: 100%; height: 50%;', label: '16:9', value: '16:9' },
  { s: 'width: 50%; height: 100%;', label: '9:16', value: '9:16' },
]

const modeOptions = [{ label: t('mj.std'), value: 'std' }, { label: t('mj.pro'), value: 'pro' }]
const durationOptions = [{ label: '5s', value: '5' }, { label: '10s', value: '10' }]
const cameraOption = [
  { label: t('mj.cnull'), value: '' },
  { label: t('mj.down_back'), value: 'down_back' },
  { label: t('mj.forward_up'), value: 'forward_up' },
  { label: t('mj.right_turn_forward'), value: 'right_turn_forward' },
  { label: t('mj.left_turn_forward'), value: 'left_turn_forward' },
]
const mvOption = [
  { label: 'kling-v1-6', value: 'kling-v1-6' },
  { label: 'kling-v1-5', value: 'kling-v1-5' },
  { label: 'kling-v1', value: 'kling-v1' },
  { label: 'kling-v2-master', value: 'kling-v2-master' },
]

function selectFile(input: any) {
  upImg(input.target.files[0]).then((d) => {
    f.value.image = d
    fsRef.value = ''
  }).catch((e) => ms.error(e))
}

function selectFile2(input: any) {
  upImg(input.target.files[0]).then((d) => {
    f.value.image_tail = d
    fsRef2.value = ''
    if (f.value.image === '') ms.info(t('mj.needImg'))
  }).catch((e) => ms.error(e))
}

const clearInput = () => {
  f.value.prompt = ''
  f.value.image = ''
  f.value.image_tail = ''
  fsRef.value = ''
  fsRef2.value = ''
}

const createImg = async () => {
  st.value.isLoading = true
  f.value.aspect_ratio = vf[st.value.bili].value
  try {
    let cat = 'text2video'
    const abc: any = { ...f.value }
    if (f.value.image !== '') {
      cat = 'image2video'
      abc.image = clearImageBase64(abc.image)
      if (f.value.image_tail) abc.image_tail = clearImageBase64(f.value.image_tail)
    } else if (st.value.camera_type) {
      abc.camera_control = { type: st.value.camera_type }
    }
    if (abc.model === 'kling-v2-master') delete abc.mode

    const d: any = await klingFetch('/v1/videos/' + cat, abc)
    mlog('img', d)
    klingFeed(d.data.task_id, cat, f.value.prompt)
  } catch (error) {}
  st.value.isLoading = false
}

onMounted(() => {
  homeStore.setMyData({ ms: ms })
})
</script>

<template>
  <div class="kg-video-panel">
    <!-- Header -->
    <div class="panel-header">
      <div class="header-icon">
        <SvgIcon icon="ri:film-line" class="text-lg" />
      </div>
      <div>
        <h3 class="header-title">可灵视频</h3>
        <p class="header-sub">Kling AI Video Generation</p>
      </div>
    </div>

    <!-- Gradient divider -->
    <div class="section-divider" />

    <!-- Aspect ratio -->
    <div class="section-block">
      <p class="section-label">
        <SvgIcon icon="ri:aspect-ratio-line" class="mr-1.5 inline-block text-sm opacity-60" />
        画面比例
      </p>
      <div class="flex gap-2">
        <button
          v-for="(item, index) in vf"
          :key="item.value"
          class="pill-btn"
          :class="{ active: index === st.bili }"
          @click="st.bili = index"
        >
          <div class="flex h-4 w-4 items-center justify-center">
            <div class="ratio-icon" :style="item.s" :class="{ active: index === st.bili }" />
          </div>
          <span>{{ item.label }}</span>
        </button>
      </div>
    </div>

    <div class="section-divider" />

    <!-- Settings -->
    <div class="section-block space-y-3">
      <p class="section-label">
        <SvgIcon icon="ri:settings-3-line" class="mr-1.5 inline-block text-sm opacity-60" />
        {{ $t('mjset.model') }}
      </p>
      <div class="setting-row">
        <span class="setting-label">{{ $t('mjset.model') }}</span>
        <n-select v-model:value="f.model" size="small" :options="mvOption" class="setting-input" />
      </div>
      <div class="setting-row">
        <span class="setting-label">{{ $t('mj.mode') }}</span>
        <n-select v-model:value="f.mode" size="small" :options="modeOptions" class="setting-input" />
      </div>
      <div class="setting-row">
        <span class="setting-label">{{ $t('mj.duration') }}</span>
        <n-select v-model:value="f.duration" size="small" :options="durationOptions" class="setting-input" />
      </div>
      <div class="setting-row">
        <span class="setting-label">{{ $t('mj.camera_type') }}</span>
        <n-select v-model:value="st.camera_type" size="small" :options="cameraOption" class="setting-input" />
      </div>
      <div class="setting-row">
        <span class="setting-label">{{ $t('mj.nohead') }}</span>
        <NInput v-model:value="f.negative_prompt" size="small" class="setting-input" clearable :placeholder="$t('mj.negative_prompt')" />
      </div>
    </div>

    <div class="section-divider" />

    <!-- Prompt -->
    <div class="section-block">
      <p class="section-label">
        <SvgIcon icon="ri:quill-pen-line" class="mr-1.5 inline-block text-sm opacity-60" />
        {{ $t('video.descpls') }}
      </p>
      <n-input
        v-model:value="f.prompt"
        :placeholder="$t('video.descpls')"
        type="textarea"
        size="small"
        class="prompt-textarea"
        :autosize="{ minRows: 3, maxRows: 10 }"
      />
    </div>

    <div class="section-divider" />

    <!-- Image upload -->
    <div class="section-block">
      <p class="section-label">
        <SvgIcon icon="ri:image-2-line" class="mr-1.5 inline-block text-sm opacity-60" />
        参考图片
      </p>
      <div class="flex gap-3">
        <!-- Start frame -->
        <div class="upload-wrapper">
          <input type="file" ref="fsRef" class="hidden" accept="image/jpeg,image/jpg,image/png,image/gif" @change="selectFile" />
          <div class="upload-box" @click="fsRef.click()">
            <template v-if="f.image">
              <img :src="f.image" class="h-full w-full object-cover" />
              <div class="upload-remove" @click.stop="f.image = ''">
                <SvgIcon icon="ri:close-line" class="text-xs" />
              </div>
            </template>
            <div v-else class="upload-placeholder">
              <SvgIcon icon="ri:image-add-line" class="text-xl" />
              <span>{{ $t('video.selectimg') }}</span>
            </div>
          </div>
        </div>
        <!-- End frame -->
        <div class="upload-wrapper">
          <input type="file" ref="fsRef2" class="hidden" accept="image/jpeg,image/jpg,image/png,image/gif" @change="selectFile2" />
          <div class="upload-box" @click="fsRef2.click()">
            <template v-if="f.image_tail">
              <img :src="f.image_tail" class="h-full w-full object-cover" />
              <div class="upload-remove" @click.stop="f.image_tail = ''">
                <SvgIcon icon="ri:close-line" class="text-xs" />
              </div>
            </template>
            <div v-else class="upload-placeholder">
              <SvgIcon icon="ri:image-add-line" class="text-xl" />
              <span>{{ $t('video.endImg') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="section-divider" />

    <!-- Generate button -->
    <div class="section-block">
      <button
        class="submit-btn"
        :class="{ disabled: !f.prompt, loading: st.isLoading, enabled: f.prompt && !st.isLoading }"
        :disabled="!f.prompt || st.isLoading"
        @click="createImg()"
      >
        <span v-if="st.isLoading" class="btn-spinner" />
        <SvgIcon v-else icon="ri:play-circle-line" class="mr-2 text-lg" />
        <span>{{ st.isLoading ? '生成中...' : $t('video.generate') }}</span>
      </button>

      <!-- Clear button -->
      <button
        v-if="f.image || f.prompt || f.image_tail"
        class="clear-btn"
        @click="clearInput"
      >
        <SvgIcon icon="ri:delete-bin-6-line" class="mr-1 text-xs" />
        {{ $t('video.clear') }}
      </button>
    </div>

    <ul class="info-list" v-html="$t('mj.klingInfo')" />
  </div>
</template>

<style scoped>
.kg-video-panel {
  height: 100%;
  overflow-y: auto;
  padding: 16px 12px;
  scrollbar-width: thin;
  scrollbar-color: rgba(139, 92, 246, 0.2) transparent;
}
.kg-video-panel::-webkit-scrollbar {
  width: 4px;
}
.kg-video-panel::-webkit-scrollbar-track {
  background: transparent;
}
.kg-video-panel::-webkit-scrollbar-thumb {
  background: rgba(139, 92, 246, 0.2);
  border-radius: 4px;
}
.kg-video-panel::-webkit-scrollbar-thumb:hover {
  background: rgba(139, 92, 246, 0.4);
}

/* Header */
.panel-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.header-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.8), rgba(99, 102, 241, 0.8));
  color: white;
  box-shadow: 0 4px 15px rgba(139, 92, 246, 0.3);
  flex-shrink: 0;
}
.header-title {
  font-size: 16px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
  margin: 0;
  letter-spacing: 0.5px;
}
.header-sub {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  margin: 2px 0 0;
}

/* Section divider */
.section-divider {
  height: 1px;
  margin: 12px 0;
  background: linear-gradient(90deg, transparent, rgba(139, 92, 246, 0.2), rgba(99, 102, 241, 0.15), transparent);
}

/* Section block */
.section-block {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 14px;
}

/* Section label */
.section-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
}

/* Pill buttons (aspect ratio) */
.pill-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 6px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
  border: 1.5px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  transition: all 0.25s ease;
}
.pill-btn:hover {
  border-color: rgba(139, 92, 246, 0.3);
  background: rgba(139, 92, 246, 0.08);
  color: rgba(255, 255, 255, 0.7);
}
.pill-btn.active {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.35), rgba(99, 102, 241, 0.3));
  border-color: rgba(139, 92, 246, 0.5);
  color: rgba(255, 255, 255, 0.95);
  box-shadow: 0 2px 12px rgba(139, 92, 246, 0.2);
}

.ratio-icon {
  border: 1.5px solid rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  transition: all 0.25s ease;
}
.ratio-icon.active {
  border-color: rgba(196, 181, 253, 0.9);
}

/* Settings */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.setting-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  flex-shrink: 0;
}
.setting-input {
  width: 65% !important;
}

/* Prompt textarea */
.prompt-textarea :deep(.n-input) {
  --n-border: 1px solid rgba(255, 255, 255, 0.08) !important;
  --n-border-hover: 1px solid rgba(139, 92, 246, 0.3) !important;
  --n-border-focus: 1px solid rgba(139, 92, 246, 0.5) !important;
  --n-color: rgba(255, 255, 255, 0.04) !important;
  --n-color-focus: rgba(255, 255, 255, 0.06) !important;
  --n-text-color: rgba(255, 255, 255, 0.85) !important;
  --n-placeholder-color: rgba(255, 255, 255, 0.25) !important;
  --n-caret-color: rgba(139, 92, 246, 0.8) !important;
  border-radius: 10px !important;
}

/* Upload */
.upload-wrapper {
  position: relative;
}
.upload-box {
  width: 80px;
  height: 80px;
  border-radius: 12px;
  border: 2px dashed rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}
.upload-box:hover {
  border-color: rgba(139, 92, 246, 0.5);
  background: rgba(139, 92, 246, 0.06);
  box-shadow: 0 0 20px rgba(139, 92, 246, 0.1);
}
.upload-box:hover .upload-placeholder {
  color: rgba(139, 92, 246, 0.7);
}
.upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: rgba(255, 255, 255, 0.25);
  font-size: 10px;
  transition: color 0.3s ease;
}
.upload-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.upload-box:hover .upload-remove {
  opacity: 1;
}
.upload-remove:hover {
  background: rgba(239, 68, 68, 0.7);
}

/* Submit button */
.submit-btn {
  width: 100%;
  padding: 12px 20px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.95);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.7), rgba(99, 102, 241, 0.7));
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.25);
}
.submit-btn.enabled {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.85), rgba(99, 102, 241, 0.85));
  box-shadow: 0 4px 25px rgba(139, 92, 246, 0.35);
  animation: pulse-glow 2.5s ease-in-out infinite;
}
.submit-btn.enabled:hover {
  background: linear-gradient(135deg, rgba(139, 92, 246, 1), rgba(99, 102, 241, 1));
  box-shadow: 0 6px 30px rgba(139, 92, 246, 0.45);
  transform: translateY(-1px);
}
.submit-btn.disabled {
  opacity: 0.35;
  cursor: not-allowed;
  box-shadow: none;
  animation: none;
}
.submit-btn.loading {
  opacity: 0.7;
  cursor: wait;
  animation: none;
}

@keyframes pulse-glow {
  0%, 100% {
    box-shadow: 0 4px 25px rgba(139, 92, 246, 0.35);
  }
  50% {
    box-shadow: 0 4px 35px rgba(139, 92, 246, 0.55), 0 0 60px rgba(139, 92, 246, 0.15);
  }
}

.btn-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  margin-right: 8px;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Clear button */
.clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin-top: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.clear-btn:hover {
  color: rgba(239, 68, 68, 0.7);
  background: rgba(239, 68, 68, 0.06);
}

/* Info list */
.info-list {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  padding: 8px 14px 16px;
  line-height: 1.6;
}
.info-list :deep(li) {
  margin-bottom: 2px;
}

/* Override Naive UI dark inputs globally within panel */
.kg-video-panel :deep(.n-input) {
  --n-border: 1px solid rgba(255, 255, 255, 0.08) !important;
  --n-border-hover: 1px solid rgba(139, 92, 246, 0.3) !important;
  --n-border-focus: 1px solid rgba(139, 92, 246, 0.5) !important;
  --n-color: rgba(255, 255, 255, 0.04) !important;
  --n-color-focus: rgba(255, 255, 255, 0.06) !important;
  --n-text-color: rgba(255, 255, 255, 0.85) !important;
  --n-placeholder-color: rgba(255, 255, 255, 0.25) !important;
  --n-caret-color: rgba(139, 92, 246, 0.8) !important;
}
.kg-video-panel :deep(.n-base-selection) {
  --n-border: 1px solid rgba(255, 255, 255, 0.08) !important;
  --n-border-hover: 1px solid rgba(139, 92, 246, 0.3) !important;
  --n-border-active: 1px solid rgba(139, 92, 246, 0.5) !important;
  --n-border-focus: 1px solid rgba(139, 92, 246, 0.5) !important;
  --n-color: rgba(255, 255, 255, 0.04) !important;
  --n-color-active: rgba(255, 255, 255, 0.06) !important;
  --n-text-color: rgba(255, 255, 255, 0.85) !important;
  --n-placeholder-color: rgba(255, 255, 255, 0.25) !important;
}
</style>
