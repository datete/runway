<script setup lang="ts">
import { computed, ref } from 'vue'
import { NInput, NButton, NTag, NSelect, useMessage } from 'naive-ui'
import { SvgIcon } from '@/components/common'
import { t } from '@/locales'
import { batchCreateJobs } from '@/api/runwayJobs'
import { useRunwayJwt } from '@/composables/useRunwayJwt'

const ms = useMessage()

const promptText = ref('')
const mode = ref('standard')
const duration = ref(5)
const resolution = ref('720p')
const referenceImage = ref<string | null>(null)
const referencePreview = ref<string | null>(null)
const isSubmitting = ref(false)
const isUploading = ref(false)
const showSuccess = ref(false)
const uploadFileSize = ref('')

const fileInput = ref<HTMLInputElement | null>(null)

const modeOptions = [
  { label: '标准', value: 'standard' },
  { label: '专业', value: 'pro' },
]

const prompts = computed(() =>
  promptText.value
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean),
)

const promptCount = computed(() => prompts.value.length)
const canSubmit = computed(() => promptCount.value > 0 && !isSubmitting.value)

const countColorClass = computed(() => {
  if (promptCount.value > 20) return 'count-red'
  if (promptCount.value > 15) return 'count-yellow'
  return 'count-normal'
})

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function selectDuration(val: number) {
  duration.value = val
}

function selectResolution(val: string) {
  resolution.value = val
}

function triggerUpload() {
  fileInput.value?.click()
}

async function handleFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file)
    return

  if (!file.type.startsWith('image/')) {
    ms.warning('请选择图片文件')
    return
  }

  referencePreview.value = URL.createObjectURL(file)
  uploadFileSize.value = formatFileSize(file.size)
  isUploading.value = true

  try {
    // Convert file to base64 and upload via /api/runway/upload
    const reader = new FileReader()
    const base64 = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    const { headers: getHeaders } = useRunwayJwt()
    const res = await fetch('/api/runway/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getHeaders() },
      body: JSON.stringify({ data: base64, filename: file.name }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Upload failed')
    referenceImage.value = json.url ?? null
    if (!referenceImage.value)
      throw new Error('Upload failed')
  }
  catch (err: any) {
    ms.error(err.message || '图片上传失败')
    removeImage()
  }
  finally {
    isUploading.value = false
    target.value = ''
  }
}

function removeImage() {
  if (referencePreview.value)
    URL.revokeObjectURL(referencePreview.value)
  referenceImage.value = null
  referencePreview.value = null
  uploadFileSize.value = ''
}

function clearAll() {
  promptText.value = ''
  mode.value = 'standard'
  duration.value = 5
  resolution.value = '720p'
  removeImage()
}

async function handleSubmit() {
  if (!canSubmit.value)
    return

  isSubmitting.value = true
  try {
    const result = await batchCreateJobs({
      prompts: prompts.value,
      mode: mode.value,
      duration: duration.value,
      resolution: resolution.value,
      ...(referenceImage.value ? { imageUrl: referenceImage.value } : {}),
    })

    const successCount = result.created?.length ?? 0
    const errorCount = result.errors?.length ?? 0

    if (successCount > 0)
      ms.success(`已提交 ${successCount} 个任务`)
    if (errorCount > 0)
      ms.warning(`${errorCount} 个任务提交失败`)

    if (successCount > 0) {
      promptText.value = ''
      showSuccess.value = true
      setTimeout(() => { showSuccess.value = false }, 1800)
    }
  }
  catch (err: any) {
    ms.error(err.message || '批量提交失败')
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="batch-panel flex flex-col gap-4 p-4 h-full overflow-y-auto">
    <!-- Success overlay -->
    <Transition name="success-fade">
      <div v-if="showSuccess" class="success-overlay">
        <div class="success-checkmark">
          <svg viewBox="0 0 52 52" class="checkmark-svg">
            <circle cx="26" cy="26" r="25" fill="none" class="checkmark-circle" />
            <path fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" class="checkmark-path" />
          </svg>
        </div>
      </div>
    </Transition>

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="header-icon">
          <SvgIcon icon="ri:stack-line" class="text-base" />
        </div>
        <div class="flex flex-col">
          <span class="text-sm font-semibold text-white/90 tracking-wide">批量生成</span>
          <span class="text-[10px] text-white/35 leading-tight">每行一条提示词</span>
        </div>
      </div>
      <NTag v-if="promptCount > 0" size="small" type="info" round>
        {{ promptCount }} 条
      </NTag>
    </div>

    <div class="section-divider" />

    <!-- Multi-prompt textarea -->
    <div class="flex flex-col gap-1.5">
      <label class="text-xs text-white/50 font-medium">提示词（每行一条）</label>
      <div class="textarea-wrapper">
        <NInput
          v-model:value="promptText"
          type="textarea"
          placeholder="输入提示词，每行一条&#10;例如：&#10;夕阳下的海边沙滩&#10;城市夜景延时摄影"
          :autosize="{ minRows: 6, maxRows: 14 }"
          class="prompt-textarea"
        />
        <div class="prompt-count" :class="countColorClass">
          {{ promptCount }} / 20 条
        </div>
      </div>
    </div>

    <div class="section-divider" />

    <!-- Mode selector -->
    <div class="flex flex-col gap-1.5">
      <label class="text-xs text-white/50 font-medium">模式</label>
      <NSelect
        v-model:value="mode"
        :options="modeOptions"
        size="small"
        class="w-full"
      />
    </div>

    <div class="section-divider" />

    <!-- Duration pills -->
    <div class="flex flex-col gap-1.5">
      <label class="text-xs text-white/50 font-medium">时长</label>
      <div class="flex gap-2">
        <button
          v-for="d in [5, 10]"
          :key="d"
          class="pill-btn"
          :class="{ active: duration === d }"
          @click="selectDuration(d)"
        >
          {{ d }}s
        </button>
      </div>
    </div>

    <!-- Resolution pills -->
    <div class="flex flex-col gap-1.5">
      <label class="text-xs text-white/50 font-medium">分辨率</label>
      <div class="flex gap-2">
        <button
          v-for="r in ['720p', '1080p']"
          :key="r"
          class="pill-btn"
          :class="{ active: resolution === r }"
          @click="selectResolution(r)"
        >
          {{ r }}
        </button>
      </div>
    </div>

    <div class="section-divider" />

    <!-- Reference image upload -->
    <div class="flex flex-col gap-1.5">
      <label class="text-xs text-white/50 font-medium">参考图（可选）</label>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        class="hidden"
        @change="handleFileChange"
      >
      <div
        v-if="!referencePreview"
        class="upload-area flex flex-col items-center justify-center gap-2 cursor-pointer"
        @click="triggerUpload"
      >
        <SvgIcon icon="ri:image-add-line" class="text-xl text-white/30" />
        <span class="text-xs text-white/35">点击上传参考图片</span>
      </div>
      <div v-else class="relative group">
        <img
          :src="referencePreview"
          alt="reference"
          class="w-full h-24 object-cover rounded-lg border border-white/10"
        >
        <div class="image-meta">
          <span v-if="uploadFileSize" class="text-[10px] text-white/50">{{ uploadFileSize }}</span>
        </div>
        <div
          v-if="isUploading"
          class="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg backdrop-blur-sm"
        >
          <div class="flex items-center gap-2">
            <div class="upload-spinner" />
            <span class="text-xs text-white/70">上传中...</span>
          </div>
        </div>
        <button
          v-else
          class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 text-white/80 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-red-500/80"
          @click="removeImage"
        >
          &times;
        </button>
      </div>
    </div>

    <div class="flex-1" />

    <!-- Action buttons -->
    <div class="action-area flex flex-col gap-2 pt-3">
      <div class="section-divider" />
      <button
        class="submit-btn"
        :class="{ 'can-submit': canSubmit, 'is-submitting': isSubmitting }"
        :disabled="!canSubmit"
        @click="handleSubmit"
      >
        <template v-if="isSubmitting">
          <div class="submit-spinner" />
          提交中...
        </template>
        <template v-else>
          <SvgIcon icon="ri:play-circle-line" class="text-base" />
          批量生成 ({{ promptCount }})
        </template>
      </button>
      <button
        class="clear-btn"
        @click="clearAll"
      >
        <SvgIcon icon="ri:delete-bin-6-line" class="text-xs" />
        清空全部
      </button>
    </div>
  </div>
</template>

<style scoped>
.batch-panel {
  position: relative;
  background:
    linear-gradient(135deg, rgba(139, 92, 246, 0.06) 0%, rgba(99, 102, 241, 0.03) 50%, rgba(255, 255, 255, 0.02) 100%),
    rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(16px);
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  border-image: linear-gradient(to bottom, rgba(139, 92, 246, 0.2), rgba(255, 255, 255, 0.06)) 1;
}

/* Thin dark scrollbar */
.batch-panel::-webkit-scrollbar {
  width: 4px;
}
.batch-panel::-webkit-scrollbar-track {
  background: transparent;
}
.batch-panel::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}
.batch-panel::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.18);
}

/* Section dividers */
.section-divider {
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(255, 255, 255, 0.06), transparent);
  margin: 2px 0;
}

/* Header icon with gradient */
.header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(99, 102, 241, 0.2));
  color: rgba(255, 255, 255, 0.9);
}

/* Textarea wrapper with count indicator */
.textarea-wrapper {
  position: relative;
}

.prompt-count {
  position: absolute;
  bottom: 8px;
  right: 10px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  pointer-events: none;
  z-index: 1;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(4px);
  transition: color 0.3s;
}
.count-normal {
  color: rgba(255, 255, 255, 0.35);
}
.count-yellow {
  color: rgba(250, 204, 21, 0.85);
}
.count-red {
  color: rgba(239, 68, 68, 0.9);
}

.prompt-textarea :deep(.n-input__textarea-el) {
  font-size: 13px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.85);
  padding-bottom: 24px !important;
}

/* Pill buttons */
.pill-btn {
  flex: 1;
  padding: 7px 0;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.50);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.07);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
  letter-spacing: 0.02em;
}

.pill-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
  border-color: rgba(255, 255, 255, 0.15);
  transform: translateY(-1px);
}

.pill-btn.active {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(99, 102, 241, 0.20));
  border-color: rgba(139, 92, 246, 0.45);
  color: rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.15);
}

/* Upload area */
.upload-area {
  height: 80px;
  border-radius: 10px;
  border: 1.5px dashed rgba(255, 255, 255, 0.10);
  background: rgba(255, 255, 255, 0.02);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.upload-area:hover {
  border-color: rgba(139, 92, 246, 0.4);
  background: rgba(139, 92, 246, 0.06);
  animation: dash-march 12s linear infinite;
}

@keyframes dash-march {
  to {
    background-position: 100% 100%;
  }
}

.upload-area:hover {
  border-style: dashed;
  animation: border-dance 0.6s linear infinite;
}

@keyframes border-dance {
  0% { border-color: rgba(139, 92, 246, 0.4); }
  50% { border-color: rgba(99, 102, 241, 0.5); }
  100% { border-color: rgba(139, 92, 246, 0.4); }
}

.image-meta {
  position: absolute;
  bottom: 4px;
  left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

/* Upload spinner */
.upload-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: rgba(255, 255, 255, 0.7);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

/* Submit button */
.submit-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 0;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: not-allowed;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  letter-spacing: 0.03em;
}

.submit-btn.can-submit {
  cursor: pointer;
  color: rgba(255, 255, 255, 0.95);
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.85), rgba(79, 70, 229, 0.85));
  border-color: rgba(139, 92, 246, 0.5);
  box-shadow:
    0 2px 12px rgba(124, 58, 237, 0.25),
    0 0 0 1px rgba(139, 92, 246, 0.1) inset;
  animation: subtle-pulse 2.5s ease-in-out infinite;
}

.submit-btn.can-submit:hover {
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.95), rgba(79, 70, 229, 0.95));
  box-shadow:
    0 4px 20px rgba(124, 58, 237, 0.35),
    0 0 0 1px rgba(139, 92, 246, 0.2) inset;
  transform: translateY(-1px);
}

.submit-btn.can-submit:active {
  transform: translateY(0);
  box-shadow: 0 1px 6px rgba(124, 58, 237, 0.2);
}

.submit-btn.is-submitting {
  cursor: wait;
  animation: none;
}

@keyframes subtle-pulse {
  0%, 100% {
    box-shadow:
      0 2px 12px rgba(124, 58, 237, 0.25),
      0 0 0 1px rgba(139, 92, 246, 0.1) inset;
  }
  50% {
    box-shadow:
      0 2px 20px rgba(124, 58, 237, 0.4),
      0 0 0 1px rgba(139, 92, 246, 0.2) inset;
  }
}

/* Submit spinner */
.submit-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: rgba(255, 255, 255, 0.9);
  border-radius: 50%;
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
  gap: 4px;
  padding: 6px 0;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.3);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
}

.clear-btn:hover {
  color: rgba(239, 68, 68, 0.7);
}

/* Success overlay */
.success-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  border-radius: inherit;
}

.success-checkmark {
  width: 64px;
  height: 64px;
}

.checkmark-svg {
  width: 100%;
  height: 100%;
}

.checkmark-circle {
  stroke: rgba(34, 197, 94, 0.6);
  stroke-width: 2;
  stroke-dasharray: 157;
  stroke-dashoffset: 157;
  animation: circle-draw 0.5s ease-out forwards;
}

.checkmark-path {
  stroke: rgba(34, 197, 94, 0.9);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 48;
  stroke-dashoffset: 48;
  animation: check-draw 0.35s 0.4s ease-out forwards;
}

@keyframes circle-draw {
  to { stroke-dashoffset: 0; }
}

@keyframes check-draw {
  to { stroke-dashoffset: 0; }
}

/* Transition */
.success-fade-enter-active {
  transition: opacity 0.25s ease-out;
}
.success-fade-leave-active {
  transition: opacity 0.5s ease-in;
}
.success-fade-enter-from,
.success-fade-leave-to {
  opacity: 0;
}
</style>
