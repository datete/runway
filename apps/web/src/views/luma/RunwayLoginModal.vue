<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NInput, NModal, useMessage } from 'naive-ui'
import { useRunwayJwt } from '@/composables/useRunwayJwt'
import { useDeviceFingerprint } from '@/composables/useDeviceFingerprint'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [v: boolean]; loggedIn: [] }>()

const { setToken } = useRunwayJwt()
const { deviceInfo } = useDeviceFingerprint()
const message = useMessage()

const username = ref('')
const password = ref('')
const loading = ref(false)

const canSubmit = computed(() => username.value.trim() !== '' && password.value.trim() !== '')

const handleLogin = async () => {
  if (!canSubmit.value || loading.value) return

  loading.value = true
  try {
    const res = await fetch('/api/runway/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username.value.trim(),
        password: password.value,
        device: deviceInfo.value,
      }),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '登录失败，请检查账号或密码')

    setToken(data.token, data.user?.username, data.user?.role)
    if (data.isNewDevice) message.warning('新设备登录，已记录', { duration: 5000 })
    if (data.isSuspicious) message.warning('检测到异常登录，管理员已收到通知', { duration: 6000 })
    message.success(`欢迎回来，${data.user?.username ?? '用户'}`)
    password.value = ''
    emit('update:show', false)
    emit('loggedIn')
  } catch (error: any) {
    message.error(error.message || '登录失败')
  } finally {
    loading.value = false
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') handleLogin()
}

watch(
  () => props.show,
  (visible) => {
    if (!visible) {
      password.value = ''
      loading.value = false
    }
  },
)
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    :closable="true"
    :mask-closable="true"
    style="width: min(92vw, 420px)"
    @update:show="emit('update:show', $event)"
  >
    <div class="rounded-2xl bg-white/95 p-1 dark:bg-slate-900/95">
      <div
        class="mb-5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-4 text-white shadow-lg shadow-cyan-500/20 dark:from-cyan-600 dark:to-blue-700"
      >
        <p class="text-lg font-semibold">视频工作台</p>
        <p class="mt-1 text-xs text-cyan-50/90">请登录后继续创建视频任务</p>
      </div>

      <div class="space-y-3 px-1 pb-1">
        <div>
          <p class="mb-1 text-xs text-slate-500 dark:text-slate-400">用户名</p>
          <NInput
            v-model:value="username"
            placeholder="请输入用户名"
            :disabled="loading"
            @keydown="handleKeydown"
          />
        </div>

        <div>
          <p class="mb-1 text-xs text-slate-500 dark:text-slate-400">密码</p>
          <NInput
            v-model:value="password"
            type="password"
            placeholder="请输入密码"
            show-password-on="click"
            :disabled="loading"
            @keydown="handleKeydown"
          />
        </div>

        <NButton
          type="primary"
          block
          size="large"
          :loading="loading"
          :disabled="!canSubmit"
          @click="handleLogin"
        >
          登录并进入
        </NButton>
      </div>
    </div>
  </NModal>
</template>
