<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useMessage, NButton, NInput, NTag } from 'naive-ui'
import { clearImageBase64, mlog, upImg } from '@/api'
import { homeStore } from '@/store'
import { klingFeed, klingFetch } from '@/api/kling'
import { SvgIcon } from '@/components/common'

const f = ref({ prompt: '', negative_prompt: '', image: '', image_fidelity: 0.5, n: 1, aspect_ratio: '1:1' })
const st = ref({ bili: 0, isLoading: false })
const showAdvanced = ref(false)

const fsRef = ref()
const ms = useMessage()

const vf = [
  { s: 'width: 100%; height: 100%;', label: '1:1', value: '1:1' },
  { s: 'width: 100%; height: 75%;', label: '4:3', value: '4:3' },
  { s: 'width: 75%; height: 100%;', label: '3:4', value: '3:4' },
  { s: 'width: 100%; height: 50%;', label: '16:9', value: '16:9' },
  { s: 'width: 50%; height: 100%;', label: '9:16', value: '9:16' },
]

const nOptions = [1, 2, 3, 4]

function selectFile(input: any) {
  upImg(input.target.files[0]).then((d) => {
    f.value.image = d
    fsRef.value = ''
  }).catch((e) => ms.error(e))
}

const clearInput = () => {
  f.value.prompt = ''
  f.value.image = ''
  fsRef.value = ''
}

const createImg = async () => {
  st.value.isLoading = true
  f.value.aspect_ratio = vf[st.value.bili].value
  const abc = { ...f.value }
  if (abc.image) abc.image = clearImageBase64(abc.image)
  try {
    const d: any = await klingFetch('/v1/images/generations ', abc)
    mlog('img', d)
    klingFeed(d.data.task_id, 'image', f.value.prompt)
  } catch (error) {}
  st.value.isLoading = false
}

onMounted(() => {
  homeStore.setMyData({ ms: ms })
})
</script>

<template>
  <div class="kg-img-panel">
    <!-- Header -->
    <div class="panel-header">
      <div class="header-icon">
        <SvgIcon icon="ri:sparkling-2-line" class="text-lg" />
      </div>
      <div>
        <h3 class="header-title">可灵图像</h3>
        <p class="header-sub">Kling AI Image Generation</p>
      </div>
    </div>

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

    <!-- Reference image + fidelity -->
    <div class="section-block">
      <p class="section-label">
        <SvgIcon icon="ri:image-line" class="mr-1.5 inline-block text-sm opacity-60" />
        参考图片
      </p>
      <div class="flex items-start gap-3">
        <div class="upload-wrapper">
          <input type="file" ref="fsRef" class="hidden" accept="image/jpeg,image/jpg,image/png,image/gif" @change="selectFile" />
          <div class="upload-box" @click="fsRef.click()">
            <template v-if="f.image">
              <img :src="f.image" class="h-full w-full object-cover" />
              <div class="upload-remove" @click.stop="f.image = ''">
                <SvgIcon icon="ri:close-circle-fill" class="text-sm" />
              </div>
            </template>
            <div v-else class="upload-placeholder">
              <SvgIcon icon="ri:image-add-line" class="text-xl" />
              <span>上传参考图</span>
              <span class="opacity-60">可选</span>
            </div>
          </div>
        </div>

        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between mb-1.5">
            <span class="fidelity-label">保真度</span>
            <span class="fidelity-value">{{ f.image_fidelity.toFixed(2) }}</span>
          </div>
          <input
            v-model.number="f.image_fidelity"
            type="range"
            min="0"
            max="1"
            step="0.05"
            class="fidelity-slider"
            :disabled="!f.image"
          />
          <p class="fidelity-hint">输入图对结果的影响程度</p>
        </div>
      </div>
    </div>

    <div class="section-divider" />

    <!-- Number of images -->
    <div class="section-block">
      <p class="section-label">
        <SvgIcon icon="ri:stack-line" class="mr-1.5 inline-block text-sm opacity-60" />
        生成数量
      </p>
      <div class="flex gap-2">
        <button
          v-for="num in nOptions"
          :key="num"
          class="num-btn"
          :class="{ active: f.n === num }"
          @click="f.n = num"
        >
          {{ num }}
        </button>
      </div>
    </div>

    <div class="section-divider" />

    <!-- Prompt -->
    <div class="section-block">
      <div class="flex items-center justify-between mb-2">
        <p class="section-label !mb-0">
          <SvgIcon icon="ri:quill-pen-line" class="mr-1.5 inline-block text-sm opacity-60" />
          {{ $t('mj.ideopls') }}
        </p>
        <span class="char-counter">{{ f.prompt.length }}</span>
      </div>
      <n-input
        v-model:value="f.prompt"
        :placeholder="$t('mj.ideopls')"
        type="textarea"
        size="small"
        class="prompt-textarea"
        :autosize="{ minRows: 3, maxRows: 10 }"
      />

      <button class="advanced-toggle" @click="showAdvanced = !showAdvanced">
        <SvgIcon icon="ri:settings-3-line" class="mr-1 text-xs" />
        <span>高级</span>
        <SvgIcon
          :icon="showAdvanced ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'"
          class="ml-auto text-sm"
        />
      </button>
      <div v-if="showAdvanced" class="mt-2">
        <NInput
          v-model:value="f.negative_prompt"
          size="small"
          clearable
          :placeholder="$t('mj.negative_prompt')"
        />
      </div>
    </div>

    <div class="section-divider" />

    <!-- Submit -->
    <div class="section-block">
      <button
        class="submit-btn"
        :class="{ disabled: !f.prompt, loading: st.isLoading, enabled: f.prompt && !st.isLoading }"
        :disabled="!f.prompt || st.isLoading"
        @click="createImg()"
      >
        <span v-if="st.isLoading" class="btn-spinner" />
        <SvgIcon v-else icon="ri:sparkling-2-line" class="mr-2 text-lg" />
        <span>{{ st.isLoading ? '生成中...' : $t('mjchat.imgcreate') }}</span>
      </button>

      <button
        v-if="f.image || f.prompt"
        class="clear-btn"
        @click="clearInput"
      >
        <SvgIcon icon="ri:delete-bin-6-line" class="mr-1 text-xs" />
        {{ $t('video.clear') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.kg-img-panel {
  height: 100%;
  overflow-y: auto;
  padding: 16px 12px;
  scrollbar-width: thin;
  scrollbar-color: rgba(139, 92, 246, 0.2) transparent;
}
.kg-img-panel::-webkit-scrollbar { width: 4px; }
.kg-img-panel::-webkit-scrollbar-track { background: transparent; }
.kg-img-panel::-webkit-scrollbar-thumb { background: rgba(139, 92, 246, 0.2); border-radius: 4px; }
.kg-img-panel::-webkit-scrollbar-thumb:hover { background: rgba(139, 92, 246, 0.4); }

.panel-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.header-icon {
  width: 40px; height: 40px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, rgba(217, 70, 239, 0.8), rgba(139, 92, 246, 0.8));
  color: white; box-shadow: 0 4px 15px rgba(139, 92, 246, 0.3); flex-shrink: 0;
}
.header-title { font-size: 16px; font-weight: 700; color: rgba(255,255,255,0.95); margin: 0; letter-spacing: 0.5px; }
.header-sub { font-size: 11px; color: rgba(255,255,255,0.4); margin: 2px 0 0; }

.section-divider {
  height: 1px; margin: 12px 0;
  background: linear-gradient(90deg, transparent, rgba(139,92,246,0.2), rgba(217,70,239,0.15), transparent);
}

.section-block {
  background: rgba(255,255,255,0.04);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  padding: 14px;
}

.section-label {
  font-size: 12px; font-weight: 600;
  color: rgba(255,255,255,0.5);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex; align-items: center;
}

.pill-btn {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 8px 6px; border-radius: 10px; font-size: 12px; font-weight: 500;
  border: 1.5px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.03);
  color: rgba(255,255,255,0.45);
  cursor: pointer; transition: all 0.25s ease;
}
.pill-btn:hover {
  border-color: rgba(139,92,246,0.3);
  background: rgba(139,92,246,0.08);
  color: rgba(255,255,255,0.7);
}
.pill-btn.active {
  background: linear-gradient(135deg, rgba(139,92,246,0.35), rgba(217,70,239,0.3));
  border-color: rgba(139,92,246,0.5);
  color: rgba(255,255,255,0.95);
  box-shadow: 0 2px 12px rgba(139,92,246,0.2);
}
.ratio-icon { border: 1.5px solid rgba(255,255,255,0.3); border-radius: 2px; transition: all 0.25s ease; }
.ratio-icon.active { border-color: rgba(196,181,253,0.9); }

.num-btn {
  flex: 1; padding: 8px 0;
  border-radius: 10px; font-size: 13px; font-weight: 600;
  border: 1.5px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.03);
  color: rgba(255,255,255,0.5);
  cursor: pointer; transition: all 0.25s ease;
}
.num-btn:hover { border-color: rgba(139,92,246,0.3); background: rgba(139,92,246,0.08); color: rgba(255,255,255,0.8); }
.num-btn.active {
  background: linear-gradient(135deg, rgba(139,92,246,0.35), rgba(217,70,239,0.3));
  border-color: rgba(139,92,246,0.5);
  color: rgba(255,255,255,0.95);
  box-shadow: 0 2px 12px rgba(139,92,246,0.2);
}

.upload-wrapper { position: relative; flex-shrink: 0; }
.upload-box {
  width: 96px; height: 96px;
  border-radius: 12px;
  border: 2px dashed rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.03);
  cursor: pointer; overflow: hidden; position: relative;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.3s ease;
}
.upload-box:hover {
  border-color: rgba(139,92,246,0.5);
  background: rgba(139,92,246,0.06);
  box-shadow: 0 0 20px rgba(139,92,246,0.1);
}
.upload-placeholder {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  color: rgba(255,255,255,0.3); font-size: 10px; text-align: center;
  padding: 0 4px;
}
.upload-remove {
  position: absolute; top: 4px; right: 4px;
  width: 20px; height: 20px; border-radius: 50%;
  background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,0.85);
  cursor: pointer; opacity: 0; transition: opacity 0.2s ease;
}
.upload-box:hover .upload-remove { opacity: 1; }
.upload-remove:hover { background: rgba(239,68,68,0.7); }

.fidelity-label { font-size: 12px; color: rgba(255,255,255,0.55); font-weight: 500; }
.fidelity-value {
  font-size: 12px; font-weight: 600; color: rgba(196,181,253,0.95);
  font-variant-numeric: tabular-nums;
  padding: 1px 8px; border-radius: 6px;
  background: rgba(139,92,246,0.15);
  border: 1px solid rgba(139,92,246,0.25);
}
.fidelity-hint { font-size: 10px; color: rgba(255,255,255,0.3); margin-top: 6px; }
.fidelity-slider {
  width: 100%; height: 6px; border-radius: 3px; appearance: none; -webkit-appearance: none;
  background: linear-gradient(90deg, rgba(255,255,255,0.15), rgba(139,92,246,0.7));
  outline: none; cursor: pointer;
}
.fidelity-slider:disabled { opacity: 0.4; cursor: not-allowed; }
.fidelity-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 16px; height: 16px; border-radius: 50%;
  background: white;
  border: 2px solid rgba(139,92,246,0.9);
  box-shadow: 0 2px 8px rgba(139,92,246,0.4);
  cursor: pointer; transition: transform 0.15s ease;
}
.fidelity-slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
.fidelity-slider::-moz-range-thumb {
  width: 16px; height: 16px; border-radius: 50%;
  background: white; border: 2px solid rgba(139,92,246,0.9);
  box-shadow: 0 2px 8px rgba(139,92,246,0.4);
  cursor: pointer;
}

.char-counter {
  font-size: 10px; color: rgba(255,255,255,0.35);
  font-variant-numeric: tabular-nums;
  padding: 1px 6px; border-radius: 5px;
  background: rgba(255,255,255,0.04);
}

.advanced-toggle {
  display: flex; align-items: center; width: 100%;
  margin-top: 10px; padding: 6px 10px;
  font-size: 11px; color: rgba(255,255,255,0.45);
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  cursor: pointer; transition: all 0.2s ease;
}
.advanced-toggle:hover {
  color: rgba(196,181,253,0.9);
  border-color: rgba(139,92,246,0.3);
  background: rgba(139,92,246,0.06);
}

.prompt-textarea :deep(.n-input) {
  --n-border: 1px solid rgba(255,255,255,0.08) !important;
  --n-border-hover: 1px solid rgba(139,92,246,0.3) !important;
  --n-border-focus: 1px solid rgba(139,92,246,0.5) !important;
  --n-color: rgba(255,255,255,0.04) !important;
  --n-color-focus: rgba(255,255,255,0.06) !important;
  --n-text-color: rgba(255,255,255,0.85) !important;
  --n-placeholder-color: rgba(255,255,255,0.25) !important;
  --n-caret-color: rgba(139,92,246,0.8) !important;
  border-radius: 10px !important;
}

.submit-btn {
  width: 100%; padding: 12px 20px; border-radius: 12px;
  font-size: 14px; font-weight: 600; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.3s ease; position: relative; overflow: hidden;
  color: rgba(255,255,255,0.95);
  background: linear-gradient(135deg, rgba(139,92,246,0.7), rgba(217,70,239,0.7));
  box-shadow: 0 4px 20px rgba(139,92,246,0.25);
}
.submit-btn.enabled {
  background: linear-gradient(135deg, rgba(139,92,246,0.9), rgba(217,70,239,0.9));
  box-shadow: 0 4px 25px rgba(139,92,246,0.35);
  animation: pulse-glow 2.5s ease-in-out infinite;
}
.submit-btn.enabled:hover {
  background: linear-gradient(135deg, rgba(139,92,246,1), rgba(217,70,239,1));
  box-shadow: 0 6px 30px rgba(139,92,246,0.45);
  transform: translateY(-1px);
}
.submit-btn.disabled { opacity: 0.35; cursor: not-allowed; box-shadow: none; animation: none; }
.submit-btn.loading { opacity: 0.7; cursor: wait; animation: none; }

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 4px 25px rgba(139,92,246,0.35); }
  50% { box-shadow: 0 4px 35px rgba(139,92,246,0.55), 0 0 60px rgba(217,70,239,0.15); }
}

.btn-spinner {
  width: 18px; height: 18px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  border-radius: 50%; margin-right: 8px;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.clear-btn {
  display: flex; align-items: center; justify-content: center;
  width: 100%; margin-top: 8px; padding: 6px 12px;
  font-size: 12px; color: rgba(255,255,255,0.35);
  background: transparent; border: none; border-radius: 8px;
  cursor: pointer; transition: all 0.2s ease;
}
.clear-btn:hover { color: rgba(239,68,68,0.7); background: rgba(239,68,68,0.06); }

.kg-img-panel :deep(.n-input) {
  --n-border: 1px solid rgba(255,255,255,0.08) !important;
  --n-border-hover: 1px solid rgba(139,92,246,0.3) !important;
  --n-border-focus: 1px solid rgba(139,92,246,0.5) !important;
  --n-color: rgba(255,255,255,0.04) !important;
  --n-color-focus: rgba(255,255,255,0.06) !important;
  --n-text-color: rgba(255,255,255,0.85) !important;
  --n-placeholder-color: rgba(255,255,255,0.25) !important;
  --n-caret-color: rgba(139,92,246,0.8) !important;
}
</style>
