import { ref } from 'vue'

export const refreshTick = ref(0)
export const bumpRefresh = () => refreshTick.value++

export const openDetailId = ref<string | null>(null)
export const detailVisible = ref(false)
