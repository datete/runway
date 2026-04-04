<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NConfigProvider } from 'naive-ui'
import { NaiveProvider } from '@/components/common'
import UpdateNotification from '@/components/common/UpdateNotification.vue'
import { useTheme } from '@/hooks/useTheme'
import { useLanguage } from '@/hooks/useLanguage'
import { startVersionCheck } from '@/utils/versionCheck'
import type { VersionInfo } from '@/utils/versionCheck'
import aiOther from "@/views/mj/aiOther.vue"

const { theme, themeOverrides } = useTheme()
const { language } = useLanguage()
const updateRef = ref<InstanceType<typeof UpdateNotification> | null>(null)

onMounted(() => {
  startVersionCheck((info: VersionInfo) => {
    updateRef.value?.open(info)
  })
})
</script>

<template>
  <NConfigProvider
    class="h-full"
    :theme="theme"
    :theme-overrides="themeOverrides"
    :locale="language"
  >
    <NaiveProvider>
      <RouterView />
    </NaiveProvider>
  </NConfigProvider>
  <aiOther/>
  <UpdateNotification ref="updateRef" />
</template>
