<script setup lang="ts">
import { computed, ref } from 'vue'
import { NModal, NCard, NInput, NInputNumber, NSlider, NButton, NSpin, useMessage } from 'naive-ui'
import { SvgIcon } from '@/components/common'
import { createReviewTask, uploadReviewRef } from '@/api/review'
import { bumpRefresh } from '../agentStore'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'created', taskId: string): void
}>()

const message = useMessage()

const genPrompt = ref('')
const qcPrompt = ref('')
const targetCount = ref(4)
const overGenRatio = ref(2)
const maxRounds = ref(3)
const aspectRatio = ref('1:1')
const resolution = ref('2k')
const refImages = ref<Array<{ url: string; assetId: string }>>([])
const uploading = ref<boolean[]>([false, false, false, false])
const submitting = ref(false)

const ratios = [
  { key: '1:1', w: 20, h: 20 },
  { key: '16:9', w: 28, h: 16 },
  { key: '9:16', w: 16, h: 28 },
  { key: '4:3', w: 24, h: 18 },
  { key: '3:4', w: 18, h: 24 },
]
const resolutions = [{ label: '2K', value: '2k' }, { label: '3K', value: '3k' }]

const firstRound = computed(() => Math.ceil(targetCount.value * overGenRatio.value))
const maxTotal = computed(() => firstRound.value * maxRounds.value)
const strategyTip = computed(
  () => `预计首轮 ${firstRound.value} 张 · 最多 ${maxRounds.value} 轮 · 上限 ${maxTotal.value} 张`,
)

const canSubmit = computed(
  () => genPrompt.value.trim().length > 0 && qcPrompt.value.trim().length > 0 && !submitting.value,
)

const close = () => emit('update:show', false)

const pickFile = (idx: number) => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    uploading.value[idx] = true
    try {
      const { url, assetId } = await uploadReviewRef(file)
      refImages.value[idx] = { url, assetId }
    } catch (e: any) {
      message.error(e?.message || '上传失败')
    } finally {
      uploading.value[idx] = false
    }
  }
  input.click()
}
const removeRef = (idx: number) => {
  refImages.value.splice(idx, 1)
}

const submit = async () => {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const { task } = await createReviewTask({
      genPrompt: genPrompt.value.trim(),
      qcPrompt: qcPrompt.value.trim(),
      refImages: refImages.value.filter(Boolean),
      aspectRatio: aspectRatio.value,
      resolution: resolution.value,
      targetCount: targetCount.value,
      overGenRatio: overGenRatio.value,
      maxRounds: maxRounds.value,
    })
    message.success('任务已创建')
    bumpRefresh()
    // reset
    genPrompt.value = ''
    qcPrompt.value = ''
    refImages.value = []
    emit('created', task.id)
  } catch (e: any) {
    message.error(e?.message || '创建失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <NModal :show="show" :mask-closable="!submitting" @update:show="emit('update:show', $event)">
    <NCard title="新建 Agent 任务" :bordered="false" size="huge" role="dialog" aria-modal="true" style="width: 620px; max-width: 92vw" class="agent-new-modal">
    <div class="space-y-3">
      <div class="rounded-xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur">
        <div class="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-200">
          <SvgIcon icon="ri:image-add-line" class="text-base text-violet-400" />
          <span>参考图</span>
          <span class="text-[10px] font-normal text-slate-500">可选 · 最多 4 张</span>
        </div>
        <div class="grid grid-cols-4 gap-2">
          <div
            v-for="i in 4"
            :key="i"
            class="group relative h-[72px] w-full cursor-pointer rounded-lg border border-dashed border-white/15 bg-black/20 transition hover:border-violet-400/50 hover:bg-violet-500/5"
            @click="!refImages[i - 1] && pickFile(i - 1)"
          >
            <NSpin v-if="uploading[i - 1]" size="small" class="absolute inset-0 flex items-center justify-center" />
            <template v-else-if="refImages[i - 1]">
              <img :src="refImages[i - 1].url" class="h-full w-full rounded-lg object-cover" />
              <button
                class="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white group-hover:flex"
                @click.stop="removeRef(i - 1)"
              >
                <SvgIcon icon="ri:close-line" class="text-xs" />
              </button>
            </template>
            <div v-else class="flex h-full w-full items-center justify-center text-slate-500">
              <SvgIcon icon="ri:add-line" class="text-2xl" />
            </div>
          </div>
        </div>
      </div>

      <div class="rounded-xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur">
        <div class="mb-2 flex items-center justify-between text-xs font-semibold text-slate-200">
          <div class="flex items-center gap-2">
            <SvgIcon icon="ri:quill-pen-line" class="text-base text-violet-400" />
            <span>生成描述</span>
          </div>
          <span class="text-[10px] font-normal text-slate-500">{{ genPrompt.length }} 字</span>
        </div>
        <NInput v-model:value="genPrompt" type="textarea" :rows="3" placeholder="描述你想要生成的画面..." />
      </div>

      <div class="rounded-xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur">
        <div class="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-200">
          <SvgIcon icon="ri:shield-check-line" class="text-base text-fuchsia-400" />
          <span>质检要求</span>
        </div>
        <NInput
          v-model:value="qcPrompt"
          type="textarea"
          :rows="4"
          placeholder="列出质检清单，例如：人物面部无畸变、手指正常、整体构图居中..."
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur">
          <div class="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-200">
            <SvgIcon icon="ri:stack-line" class="text-base text-violet-400" />
            <span>数量策略</span>
          </div>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-[11px] text-slate-400">目标数量</span>
              <NInputNumber v-model:value="targetCount" :min="1" :max="20" size="small" style="width: 92px" />
            </div>
            <div>
              <div class="mb-1 flex items-center justify-between">
                <span class="text-[11px] text-slate-400">过量系数</span>
                <span class="text-[11px] text-violet-300">{{ overGenRatio }}×</span>
              </div>
              <NSlider v-model:value="overGenRatio" :min="1" :max="4" :step="0.5" />
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[11px] text-slate-400">最多轮次</span>
              <NInputNumber v-model:value="maxRounds" :min="1" :max="5" size="small" style="width: 92px" />
            </div>
            <div class="rounded-lg bg-violet-500/10 px-2 py-1.5 text-center text-[10px] text-violet-200">
              {{ strategyTip }}
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur">
          <div class="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-200">
            <SvgIcon icon="ri:settings-3-line" class="text-base text-fuchsia-400" />
            <span>生成参数</span>
          </div>
          <div class="mb-3">
            <div class="mb-1.5 text-[11px] text-slate-400">宽高比</div>
            <div class="flex gap-1.5">
              <button
                v-for="r in ratios"
                :key="r.key"
                :class="[
                  'flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 text-[10px] transition',
                  aspectRatio === r.key
                    ? 'border-violet-400 bg-violet-500/20 text-violet-200'
                    : 'border-white/10 bg-black/20 text-slate-400 hover:border-white/20',
                ]"
                @click="aspectRatio = r.key"
              >
                <div
                  class="rounded-sm border"
                  :class="aspectRatio === r.key ? 'border-violet-300' : 'border-slate-500'"
                  :style="{ width: r.w + 'px', height: r.h + 'px' }"
                />
                <span>{{ r.key }}</span>
              </button>
            </div>
          </div>
          <div>
            <div class="mb-1.5 text-[11px] text-slate-400">分辨率</div>
            <div class="flex gap-1.5">
              <button
                v-for="r in resolutions"
                :key="r.value"
                :class="[
                  'flex-1 rounded-lg border px-2 py-1.5 text-xs transition',
                  resolution === r.value
                    ? 'border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-200'
                    : 'border-white/10 bg-black/20 text-slate-400 hover:border-white/20',
                ]"
                @click="resolution = r.value"
              >
                {{ r.label }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-1">
        <NButton :disabled="submitting" quaternary @click="close">取消</NButton>
        <NButton :disabled="!canSubmit" :loading="submitting" class="agent-cta" @click="submit">
          🚀 开始任务
        </NButton>
      </div>
    </div>
  </NCard>
  </NModal>
</template>

<style>
.agent-new-modal .n-card-header__main {
  background: linear-gradient(90deg, #a78bfa, #f0abfc);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-weight: 600;
}
.agent-new-modal .n-card {
  background: linear-gradient(180deg, #14101f 0%, #0d0a18 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
}
</style>

<style scoped>
.agent-cta {
  background-image: linear-gradient(90deg, #8b5cf6, #d946ef) !important;
  color: #fff !important;
  border: 0 !important;
  box-shadow: 0 0 24px rgba(168, 85, 247, 0.45);
}
.agent-cta:disabled {
  opacity: 0.45;
  box-shadow: none;
}
</style>
