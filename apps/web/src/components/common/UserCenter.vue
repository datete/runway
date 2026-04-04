<script setup lang="ts">
import { ref, watch } from "vue"
import {
  NDrawer,
  NDrawerContent,
  NTag,
  NProgress,
  NCollapse,
  NCollapseItem,
  NInput,
  NButton,
  NSpace,
  NSpin,
  NList,
  NListItem,
  NThing,
  NIcon,
  useMessage,
} from "naive-ui"
import { useRunwayUser } from "@/composables/useRunwayUser"

/* ---- props / emits ---- */
interface Props {
  show: boolean
}
interface Emit {
  (e: "update:show", val: boolean): void
}
const props = defineProps<Props>()
const emit = defineEmits<Emit>()

const visible = ref(props.show)
watch(() => props.show, v => (visible.value = v))
watch(visible, v => emit("update:show", v))

/* ---- composable ---- */
const { username, role, isAdmin, quota, fetchQuota, removeToken, headers } =
  useRunwayUser()

/* ---- auto-refresh quota on open ---- */
watch(
  () => props.show,
  async (v) => {
    if (v) {
      try { await fetchQuota() } catch { /* ignore */ }
    }
  },
)

/* ---- change password ---- */
const oldPwd = ref("")
const newPwd = ref("")
const confirmPwd = ref("")
const changingPwd = ref(false)
const msg = useMessage()

async function handleChangePassword() {
  if (!oldPwd.value || !newPwd.value) {
    msg.warning("请填写完整")
    return
  }
  if (newPwd.value !== confirmPwd.value) {
    msg.warning("两次密码不一致")
    return
  }
  changingPwd.value = true
  try {
    const res = await fetch("/api/runway/auth/change-password", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        oldPassword: oldPwd.value,
        newPassword: newPwd.value,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.message || "修改失败")
    }
    msg.success("密码已修改")
    oldPwd.value = ""
    newPwd.value = ""
    confirmPwd.value = ""
  } catch (e: any) {
    msg.error(e.message ?? "修改密码失败")
  } finally {
    changingPwd.value = false
  }
}

/* ---- devices ---- */
interface DeviceInfo {
  id: string
  ua: string
  ip: string
  lastActive: string
}
const devices = ref<DeviceInfo[]>([])
const loadingDevices = ref(false)

async function fetchDevices() {
  loadingDevices.value = true
  try {
    const res = await fetch("/api/runway/auth/devices", { headers: headers() })
    if (!res.ok) throw new Error("获取设备列表失败")
    const data = await res.json()
    devices.value = Array.isArray(data) ? data : data.devices ?? []
  } catch (e: any) {
    msg.error(e.message ?? "获取设备列表失败")
  } finally {
    loadingDevices.value = false
  }
}

/* ---- logout ---- */
function handleLogout() {
  removeToken()
  window.location.reload()
}

/* ---- helpers ---- */
function pct(used: number, total: number) {
  if (!total) return 0
  return Math.round((used / total) * 100)
}
</script>

<template>
  <NDrawer v-model:show="visible" :width="360" placement="right">
    <NDrawerContent title="用户中心" closable>
      <!-- 1. User Info -->
      <div class="mb-6">
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-lg"
          >
            {{ (username ?? "U").charAt(0).toUpperCase() }}
          </div>
          <div>
            <div class="text-base font-medium">{{ username }}</div>
            <NTag :type="isAdmin ? warning : info" size="small" round>
              {{ isAdmin ? "管理员" : "用户" }}
            </NTag>
          </div>
        </div>
      </div>

      <!-- 2. Quota Overview -->
      <div class="mb-6">
        <div class="text-sm font-medium mb-3 opacity-70">配额概览</div>

        <div class="space-y-4">
          <!-- Daily -->
          <div>
            <div class="flex justify-between text-xs mb-1">
              <span>今日用量</span>
              <span>{{ quota.dailyUsed }} / {{ quota.dailyQuota }}</span>
            </div>
            <NProgress
              type="line"
              :percentage="pct(quota.dailyUsed, quota.dailyQuota)"
              :show-indicator="false"
              :height="8"
              :border-radius="4"
              status="info"
            />
          </div>

          <!-- Total -->
          <div>
            <div class="flex justify-between text-xs mb-1">
              <span>总用量</span>
              <span>{{ quota.totalUsed }} / {{ quota.totalQuota }}</span>
            </div>
            <NProgress
              type="line"
              :percentage="pct(quota.totalUsed, quota.totalQuota)"
              :show-indicator="false"
              :height="8"
              :border-radius="4"
              status="success"
            />
          </div>

          <!-- Active Tasks -->
          <div>
            <div class="flex justify-between text-xs mb-1">
              <span>活跃任务</span>
              <span>{{ quota.activeTasks }} / {{ quota.maxConcurrency }}</span>
            </div>
            <NProgress
              type="line"
              :percentage="pct(quota.activeTasks, quota.maxConcurrency)"
              :show-indicator="false"
              :height="8"
              :border-radius="4"
              status="warning"
            />
          </div>
        </div>
      </div>

      <!-- 3 & 4. Collapse panels -->
      <NCollapse>
        <!-- Change Password -->
        <NCollapseItem title="修改密码" name="password">
          <div class="space-y-3">
            <NInput
              v-model:value="oldPwd"
              type="password"
              show-password-on="click"
              placeholder="旧密码"
            />
            <NInput
              v-model:value="newPwd"
              type="password"
              show-password-on="click"
              placeholder="新密码"
            />
            <NInput
              v-model:value="confirmPwd"
              type="password"
              show-password-on="click"
              placeholder="确认新密码"
            />
            <NButton
              type="primary"
              block
              :loading="changingPwd"
              @click="handleChangePassword"
            >
              确认修改
            </NButton>
          </div>
        </NCollapseItem>

        <!-- Devices -->
        <NCollapseItem title="设备管理" name="devices" @after-enter="fetchDevices">
          <NSpin :show="loadingDevices">
            <NList v-if="devices.length" bordered size="small">
              <NListItem v-for="d in devices" :key="d.id">
                <NThing :title="d.ua || 未知设备" :description="`IP: ${d.ip}`">
                  <template #header-extra>
                    <span class="text-xs opacity-50">{{ d.lastActive }}</span>
                  </template>
                </NThing>
              </NListItem>
            </NList>
            <div v-else class="text-center text-sm opacity-50 py-4">
              暂无设备信息
            </div>
          </NSpin>
        </NCollapseItem>
      </NCollapse>

      <!-- 5. Logout -->
      <template #footer>
        <NButton type="error" block @click="handleLogout">
          退出登录
        </NButton>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>
