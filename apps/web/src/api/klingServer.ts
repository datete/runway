import { useRunwayJwt } from '@/composables/useRunwayJwt'

const BASE = '/api/kling'

function authHeaders(): Record<string, string> {
  const { token } = useRunwayJwt()
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token.value) h['Authorization'] = 'Bearer ' + token.value
  return h
}

export async function recordKlingJob(taskId: string, cat: string, prompt: string): Promise<void> {
  try {
    await fetch(`${BASE}/jobs`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ taskId, cat, prompt }),
    })
  } catch (e) {
    console.warn('[klingServer] recordKlingJob failed', e)
  }
}

export async function updateKlingJob(
  taskId: string,
  patch: { status?: string; resultUrl?: string },
): Promise<void> {
  try {
    await fetch(`${BASE}/jobs/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(patch),
    })
  } catch (e) {
    console.warn('[klingServer] updateKlingJob failed', e)
  }
}

export async function listKlingJobs(params: {
  userId?: string
  status?: string
  cat?: string
  limit?: number
  offset?: number
}): Promise<{ jobs: any[]; total: number }> {
  try {
    const q = new URLSearchParams()
    if (params.userId) q.set('userId', params.userId)
    if (params.status) q.set('status', params.status)
    if (params.cat) q.set('cat', params.cat)
    if (params.limit != null) q.set('limit', String(params.limit))
    if (params.offset != null) q.set('offset', String(params.offset))
    const res = await fetch(`${BASE}/jobs?${q.toString()}`, { headers: authHeaders() })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    return { jobs: data.jobs || [], total: data.total || 0 }
  } catch (e) {
    console.warn('[klingServer] listKlingJobs failed', e)
    return { jobs: [], total: 0 }
  }
}

export async function listKlingJobUsers(): Promise<{
  users: { id: string; username: string; jobCount: number }[]
}> {
  try {
    const res = await fetch(`${BASE}/jobs/users`, { headers: authHeaders() })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    return { users: data.users || [] }
  } catch (e) {
    console.warn('[klingServer] listKlingJobUsers failed', e)
    return { users: [] }
  }
}
