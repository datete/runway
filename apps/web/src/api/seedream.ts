import { homeStore } from "@/store"
import { mlog } from "./mjapi"
import { SeedreamTask, seedreamStore } from "./seedreamStore"
import { useRunwayJwt } from "@/composables/useRunwayJwt"

const API_BASE = '/api/runway'

const buildHeaders = (withJson = true) => {
  const { headers: getHeaders } = useRunwayJwt()
  const h: Record<string, string> = { ...getHeaders() }
  if (withJson) h['Content-Type'] = 'application/json'
  return h
}

const jobToTask = (job: any): SeedreamTask => {
  const images = Array.isArray(job.images) ? job.images : []
  return {
    cat: 'image',
    prompt: job.prompt,
    model: 'seedream-5.0',
    size: `${job.aspectRatio} ${job.resolution}`,
    n: job.numImages,
    last_feed: Date.now(),
    code: 0,
    message: job.errorMessage || (job.status || 'pending'),
    request_id: job.id,
    data: {
      task_id: job.id,
      task_status: (job.status || '').toLowerCase() === 'succeeded' ? 'succeed'
                  : (job.status || '').toLowerCase() === 'failed' ? 'failed'
                  : 'pending',
      task_status_msg: job.errorMessage || '',
      created_at: new Date(job.createdAt).getTime(),
      updated_at: new Date(job.updatedAt || job.createdAt).getTime(),
      task_result: { images: images.map((img: any, i: number) => ({ index: i, url: img.url || img })) }
    }
  } as SeedreamTask
}

export const seedreamUpload = async (file: File): Promise<{ assetId: string; url: string; filename: string }> => {
  const base64: string = await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = reject
    r.readAsDataURL(file)
  })
  const res = await fetch(`${API_BASE}/seedream/upload`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify({ data: base64, filename: file.name }),
  })
  const d = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error(d.error || '上传失败')
  return { assetId: d.assetId, url: d.url, filename: file.name }
}

export const seedreamGenerate = async (payload: any, prompt: string) => {
  const store = new seedreamStore()
  mlog('seedreamGenerate', payload)

  let res: Response
  try {
    res = await fetch(`${API_BASE}/seedream`, {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify({
        prompt,
        aspectRatio: payload.aspectRatio,
        resolution: payload.resolution,
        numImages: payload.numImages || 1,
        exploreMode: payload.exploreMode !== false,
        referenceImages: payload.referenceImages || undefined,
      }),
    })
  } catch (e: any) {
    throw new Error('网络请求失败: ' + (e?.message || e))
  }
  const text = await res.text()
  let d: any = null
  try { d = text ? JSON.parse(text) : null } catch {
    throw new Error('响应解析失败: ' + text.slice(0, 200))
  }
  if (!res.ok) throw new Error(d?.error || ('HTTP ' + res.status))
  const task = jobToTask(d.job)
  store.save(task)
  homeStore.setMyData({ act: 'SeedreamFeed' })
  return task
}

export const seedreamFetchList = async (): Promise<SeedreamTask[]> => {
  const res = await fetch(`${API_BASE}/seedream`, { headers: buildHeaders(false) })
  if (!res.ok) throw new Error('列表加载失败 ' + res.status)
  const d = await res.json()
  const tasks = (d.jobs || []).map(jobToTask)
  const store = new seedreamStore()
  tasks.forEach((t: SeedreamTask) => store.save(t))
  return tasks
}

export const seedreamRefreshOne = async (id: string): Promise<SeedreamTask | null> => {
  const res = await fetch(`${API_BASE}/seedream/${id}`, { headers: buildHeaders(false) })
  if (!res.ok) return null
  const d = await res.json()
  if (!d.job) return null
  const t = jobToTask(d.job)
  new seedreamStore().save(t)
  return t
}

export const seedreamDelete = async (id: string): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/seedream/${id}`, { method: 'DELETE', headers: buildHeaders(false) })
    return res.ok
  } catch { return false }
}
