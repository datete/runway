/**
 * API client for Runway backend job queue system (POST /jobs, GET /jobs, etc.)
 * Uses the same JWT auth as the admin panel (useRunwayJwt).
 * Separate from the direct runwayFetch API used by runwayInput.vue.
 */
import { useRunwayJwt } from '@/composables/useRunwayJwt'

const BASE = '/api/runway'

async function request(path: string, method = 'GET', body?: any): Promise<any> {
  const { headers: getHeaders } = useRunwayJwt()
  const h: Record<string, string> = { ...getHeaders() }
  if (body) h['Content-Type'] = 'application/json'

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

/** List all jobs for the current user (with queue positions) */
export function fetchJobs(): Promise<any[]> {
  return request('/jobs')
}

/** Create a single job */
export function createJob(params: {
  prompt: string; mode: string; imageUrl?: string; duration?: number;
  resolution?: string; quality?: string; cfgScale?: number; sound?: boolean; videoUrl?: string;
}): Promise<any> {
  return request('/jobs', 'POST', params)
}

/** Batch create multiple jobs */
export function batchCreateJobs(params: {
  prompts: string[]; mode: string; imageUrl?: string; duration?: number; resolution?: string;
}): Promise<{ total: number; created: any[]; errors: any[] }> {
  return request('/jobs/batch', 'POST', params)
}

/** Cancel an active job */
export function cancelJob(id: string): Promise<any> {
  return request(`/jobs/${id}/cancel`, 'POST')
}

/** Retry a failed job */
export function retryJob(id: string): Promise<any> {
  return request(`/jobs/${id}/retry`, 'POST')
}

/** Delete a job */
export function deleteJob(id: string): Promise<any> {
  return request(`/jobs/${id}`, 'DELETE')
}

/** Get token/account pool status */
export function getTokenStatus(): Promise<any> {
  return request('/token-status')
}
