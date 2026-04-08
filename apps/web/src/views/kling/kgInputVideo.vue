<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useMessage, NButton, NInput, NTag, NSelect } from 'naive-ui'
import { clearImageBase64, mlog, upImg } from '@/api'
import { homeStore } from '@/store'
import { klingFeed, klingFetch } from '@/api/kling'
import { recordKlingJob } from '@/api/klingServer'
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
    recordKlingJob(d.data.task_id, cat, f.value.prompt)
  } catch (error) {}
  st.value.isLoading = false
}

const showAdvanced = ref(false)
const dragOver = ref({ a: false, b: false })

const cameraIcon = (v) => {
  const m = {
    '': 'ri:close-line',
    down_back: 'ri:arrow-down-line',
    forward_up: 'ri:arrow-up-line',
    right_turn_forward: 'ri:arrow-right-line',
    left_turn_forward: 'ri:arrow-left-line',
  }
  return m[v] || 'ri:camera-lens-line'
}
const modelTag = (v) => {
  if (v === 'kling-v2-master') return 'v2'
  if (v === 'kling-v1-6') return 'v1.6'
  if (v === 'kling-v1-5') return 'v1.5'
  return 'v1'
}
function onDrop(e, which) {
  e.preventDefault()
  dragOver.value[which] = false
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
  if (!file) return
  upImg(file).then((d) => {
    if (which === 'a') f.value.image = d
    else f.value.image_tail = d
  }).catch((er) => ms.error(er))
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
      <div class="flex-1 min-w-0">
        <h3 class="header-title">可灵视频</h3>
        <p class="header-sub">Kling AI Video Generation</p>
      </div>
    </div>

    <div class="space-y-3">
      <!-- CANVAS CARD -->
      <div class="kcard">
        <p class="ksection-label">画面 · CANVAS</p>

        <div class="flex gap-2 mb-3">
          <button
            v-for="(item, index) in vf"
            :key="item.value"
            class="ratio-btn"
            :class="{ active: index === st.bili }"
            @click="st.bili = index"
          >
            <div class="ratio-visual-wrap">
              <div
                class="ratio-visual"
                :class="{ active: index === st.bili }"
                :style="item.value === '1:1' ? 'width:22px;height:22px' : item.value === '16:9' ? 'width:28px;height:16px' : 'width:14px;height:24px'"
              />
            </div>
            <span class="ratio-label">{{ item.label }}</span>
          </button>
        </div>

        <div class="flex items-center gap-2">
          <div class="upload-wrapper flex-1">
            <input type="file" ref="fsRef" class="hidden" accept="image/jpeg,image/jpg,image/png,image/gif" @change="selectFile" />
            <div
              class="upload-box"
              :class="{ 'has-image': f.image, 'drag-over': dragOver.a }"
              @click="fsRef.click()"
              @dragover.prevent="dragOver.a = true"
              @dragleave.prevent="dragOver.a = false"
              @drop="onDrop($event, 'a')"
            >
              <template v-if="f.image">
                <img :src="f.image" class="h-full w-full object-cover" />
                <div class="upload-remove" @click.stop="f.image = ''">
                  <SvgIcon icon="ri:close-circle-fill" class="text-base" />
                </div>
                <div class="upload-tag">起始帧</div>
              </template>
              <div v-else class="upload-placeholder">
                <SvgIcon icon="ri:image-add-line" class="text-2xl" />
                <span>起始帧</span>
                <span class="upload-hint">点击或拖拽</span>
              </div>
            </div>
          </div>

          <SvgIcon
            v-if="f.image && f.image_tail"
            icon="ri:arrow-right-line"
            class="text-violet-300 text-lg shrink-0"
          />

          <div class="upload-wrapper flex-1">
            <input type="file" ref="fsRef2" class="hidden" accept="image/jpeg,image/jpg,image/png,image/gif" @change="selectFile2" />
            <div
              class="upload-box"
              :class="{ 'has-image': f.image_tail, 'drag-over': dragOver.b }"
              @click="fsRef2.click()"
              @dragover.prevent="dragOver.b = true"
              @dragleave.prevent="dragOver.b = false"
              @drop="onDrop($event, 'b')"
            >
              <template v-if="f.image_tail">
                <img :src="f.image_tail" class="h-full w-full object-cover" />
                <div class="upload-remove" @click.stop="f.image_tail = ''">
                  <SvgIcon icon="ri:close-circle-fill" class="text-base" />
                </div>
                <div class="upload-tag">尾帧</div>
              </template>
              <div v-else class="upload-placeholder">
                <SvgIcon icon="ri:image-add-line" class="text-2xl" />
                <span>尾帧</span>
                <span class="upload-hint">可选</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- PROMPT CARD -->
      <div class="kcard">
        <p class="ksection-label">
          <SvgIcon icon="ri:sparkling-2-line" class="mr-1 inline-block" />
          提示词 · PROMPT
        </p>
        <div class="prompt-wrap">
          <n-input
            v-model:value="f.prompt"
            placeholder="描述你想生成的画面，例如：一只白猫在樱花树下奔跑，阳光穿过花瓣..."
            type="textarea"
            size="small"
            class="prompt-textarea"
            :autosize="{ minRows: 3, maxRows: 8 }"
          />
          <div class="prompt-counter">{{ (f.prompt || '').length }}/500</div>
        </div>

        <button class="advanced-toggle" @click="showAdvanced = !showAdvanced">
          <SvgIcon :icon="showAdvanced ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'" class="text-sm" />
          高级 · Advanced
        </button>
        <div v-if="showAdvanced" class="mt-2">
          <NInput
            v-model:value="f.negative_prompt"
            size="small"
            clearable
            placeholder="负面提示词（不希望出现的内容）"
          />
        </div>
      </div>

      <!-- CAMERA CARD (text2video only) -->
      <div v-if="!f.image" class="kcard">
        <p class="ksection-label">
          <SvgIcon icon="ri:camera-lens-line" class="mr-1 inline-block" />
          镜头 · CAMERA
        </p>
        <div class="camera-row">
          <button
            v-for="opt in cameraOption"
            :key="opt.value"
            class="camera-chip"
            :class="{ active: st.camera_type === opt.value }"
            @click="st.camera_type = opt.value"
          >
            <SvgIcon :icon="cameraIcon(opt.value)" class="text-sm" />
            <span>{{ opt.label }}</span>
          </button>
        </div>
      </div>

      <!-- SETTINGS CARD -->
      <div class="kcard">
        <p class="ksection-label">
          <SvgIcon icon="ri:settings-3-line" class="mr-1 inline-block" />
          参数 · SETTINGS
        </p>

        <div class="setting-row">
          <span class="setting-label">{{ $t('mjset.model') }}</span>
          <div class="setting-ctrl flex items-center gap-2">
            <n-select v-model:value="f.model" size="small" :options="mvOption" class="flex-1" />
            <span class="model-tag">{{ modelTag(f.model) }}</span>
          </div>
        </div>

        <div v-if="f.model !== 'kling-v2-master'" class="setting-row">
          <span class="setting-label">{{ $t('mj.mode') }}</span>
          <div class="seg-group">
            <button
              v-for="opt in modeOptions"
              :key="opt.value"
              class="seg-btn"
              :class="{ active: f.mode === opt.value }"
              @click="f.mode = opt.value"
            >{{ opt.label }}</button>
          </div>
        </div>

        <div class="setting-row">
          <span class="setting-label">{{ $t('mj.duration') }}</span>
          <div class="seg-group">
            <button
              v-for="opt in durationOptions"
              :key="opt.value"
              class="seg-btn"
              :class="{ active: f.duration === opt.value }"
              @click="f.duration = opt.value"
            >{{ opt.label }}</button>
          </div>
        </div>
      </div>

      <!-- CTA -->
      <div class="relative">
        <button
          class="submit-btn"
          :class="{ disabled: !f.prompt && !f.image, loading: st.isLoading, enabled: (f.prompt || f.image) && !st.isLoading }"
          :disabled="(!f.prompt && !f.image) || st.isLoading"
          :title="(!f.prompt && !f.image) ? '请填写提示词或上传参考图片' : ''"
          @click="createImg()"
        >
          <span v-if="st.isLoading" class="btn-spinner" />
          <SvgIcon v-else icon="ri:magic-line" class="mr-2 text-lg" />
          <span>{{ st.isLoading ? '生成中...' : $t('video.generate') }}</span>
        </button>
        <div v-if="st.isLoading" class="progress-bar"><span /></div>

        <button
          v-if="f.image || f.prompt || f.image_tail"
          class="clear-btn"
          @click="clearInput"
        >
          <SvgIcon icon="ri:delete-bin-6-line" class="mr-1 text-xs" />
          {{ $t('video.clear') }}
        </button>
      </div>
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

/* --- Polished additions --- */
.kcard {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 12px;
}
.ksection-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.4);
  font-weight: 600;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
}
.ratio-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 6px;
  border-radius: 10px;
  border: 1.5px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  transition: all 0.25s ease;
}
.ratio-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.85);
}
.ratio-btn.active {
  border-color: rgba(167, 139, 250, 0.6);
  background: rgba(139, 92, 246, 0.15);
  color: rgba(237, 233, 254, 1);
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15), 0 0 20px rgba(139, 92, 246, 0.25);
}
.ratio-visual-wrap {
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ratio-visual {
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  border-radius: 3px;
  transition: all 0.25s ease;
}
.ratio-visual.active {
  border-color: rgba(196, 181, 253, 0.95);
  background: rgba(139, 92, 246, 0.25);
}
.ratio-label {
  font-size: 11px;
  font-weight: 600;
}
.upload-box {
  width: 100%;
  height: 96px;
  border-radius: 12px;
  border: 2px dashed rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s ease;
}
.upload-box:hover {
  border-color: rgba(167, 139, 250, 0.55);
  background: rgba(139, 92, 246, 0.06);
}
.upload-box.has-image {
  border-style: solid;
  border-color: rgba(139, 92, 246, 0.4);
}
.upload-box.drag-over {
  border-color: rgba(217, 70, 239, 0.8);
  background: rgba(217, 70, 239, 0.1);
  box-shadow: 0 0 0 3px rgba(217, 70, 239, 0.15);
}
.upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  color: rgba(255, 255, 255, 0.35);
  font-size: 11px;
}
.upload-hint {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.25);
}
.upload-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  color: rgba(255, 255, 255, 0.95);
  background: rgba(0, 0, 0, 0.55);
  border-radius: 50%;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}
.upload-remove:hover { color: rgb(248, 113, 113); transform: scale(1.1); }
.upload-tag {
  position: absolute;
  bottom: 4px;
  left: 4px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: rgba(255, 255, 255, 0.9);
}
.prompt-wrap { position: relative; }
.prompt-counter {
  position: absolute;
  right: 8px;
  bottom: 6px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  pointer-events: none;
}
.advanced-toggle {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
}
.advanced-toggle:hover { color: rgba(196, 181, 253, 0.9); }
.camera-row {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: none;
}
.camera-row::-webkit-scrollbar { display: none; }
.camera-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s;
}
.camera-chip:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
}
.camera-chip.active {
  background: rgba(139, 92, 246, 0.2);
  border-color: rgba(167, 139, 250, 0.5);
  color: rgba(237, 233, 254, 1);
}
.kcard .setting-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.kcard .setting-row:last-child { margin-bottom: 0; }
.kcard .setting-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  width: 56px;
  flex-shrink: 0;
}
.kcard .setting-ctrl { flex: 1; }
.model-tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(139, 92, 246, 0.2);
  border: 1px solid rgba(167, 139, 250, 0.35);
  color: rgba(221, 214, 254, 0.95);
  font-weight: 600;
}
.seg-group {
  display: inline-flex;
  flex: 1;
  padding: 3px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
}
.seg-btn {
  flex: 1;
  padding: 5px 10px;
  font-size: 12px;
  border-radius: 7px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: all 0.2s;
}
.seg-btn:hover { color: rgba(255, 255, 255, 0.8); }
.seg-btn.active {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.9), rgba(217, 70, 239, 0.85));
  color: white;
  box-shadow: 0 2px 8px rgba(139, 92, 246, 0.35);
}
.progress-bar {
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 4px;
  height: 2px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.progress-bar span {
  display: block;
  height: 100%;
  width: 35%;
  background: linear-gradient(90deg, rgba(139, 92, 246, 1), rgba(217, 70, 239, 1));
  border-radius: 2px;
  animation: progressSlide 1.4s ease-in-out infinite;
}
@keyframes progressSlide {
  0% { transform: translateX(-100%); width: 30%; }
  50% { width: 55%; }
  100% { transform: translateX(320%); width: 30%; }
}

</style>
