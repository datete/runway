import { useRunwayJwt } from '@/composables/useRunwayJwt'

const BASE = '/api/review'

async function req<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const { headers } = useRunwayJwt()
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...headers(),
      ...(init.headers || {}),
    },
  })
  if (res.status === 404) {
    const err: any = new Error('后端未就绪')
    err.code = 404
    throw err
  }
  if (!res.ok) {
    let msg = '请求失败'
    try {
      const j = await res.json()
      msg = j?.message || j?.error || msg
    } catch {}
    throw new Error(msg)
  }
  return res.json()
}

export interface ReviewItem {
  id: string
  taskId: string
  round: number
  status: string
  seedreamJobId?: string
  currentImageUrl?: string
  finalImageUrl?: string
  lastReason?: string
  history?: any[]
  createdAt: string
}

export interface ReviewTask {
  id: string
  title?: string
  genPrompt: string
  qcPrompt: string
  refImages?: string[]
  aspectRatio?: string
  resolution?: string
  targetCount: number
  overGenRatio?: number
  maxRounds?: number
  currentRound?: number
  passedCount?: number
  status: string
  createdAt: string
  items?: ReviewItem[]
}

export function createReviewTask(body: Partial<ReviewTask>) {
  return req<{ ok: boolean; task: ReviewTask }>('/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function listReviewTasks(params: { status?: string; limit?: number } = {}) {
  const qs = new URLSearchParams()
  if (params.status) qs.set('status', params.status)
  if (params.limit) qs.set('limit', String(params.limit))
  const q = qs.toString()
  return req<{ tasks: ReviewTask[]; total: number }>('/tasks' + (q ? '?' + q : ''))
}

export function getReviewTask(id: string) {
  return req<{ task: ReviewTask }>('/tasks/' + id)
}

export function cancelReviewTask(id: string) {
  return req<{ ok: boolean; task: ReviewTask }>('/tasks/' + id + '/cancel', { method: 'POST' })
}

export function extendReviewTask(id: string) {
  return req<{ ok: boolean; task: ReviewTask }>('/tasks/' + id + '/extend', { method: 'POST' })
}

export function retryReviewItem(id: string) {
  return req<{ ok: boolean; item: ReviewItem }>('/items/' + id + '/retry', { method: 'POST' })
}

export async function uploadReviewRef(file: File) {
  const base64: string = await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = reject
    r.readAsDataURL(file)
  })
  const { headers } = useRunwayJwt()
  const res = await fetch('/api/runway/seedream/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers() },
    body: JSON.stringify({ data: base64, filename: file.name }),
  })
  if (!res.ok) {
    let msg = '上传失败'
    try { const j = await res.json(); msg = j?.message || j?.error || msg } catch {}
    throw new Error(msg)
  }
  return res.json() as Promise<{ url: string; assetId: string; filename?: string }>
}
