import { ss } from "@/utils/storage";

export interface SeedreamTask {
  cat?: string
  prompt?: string
  negative_prompt?: string
  last_feed?: number
  model?: string
  size?: string
  quality?: string
  n?: number
  code: number
  message: string
  request_id: string
  data: {
    task_id: string
    task_status: string
    task_status_msg: string
    created_at: number
    updated_at: number
    task_result?: {
      images: Array<{ index: number; url: string }> | null
    }
  }
}

export class seedreamStore {
  private localKey = 'seedream-store'

  public save(obj: SeedreamTask) {
    if (!obj.data.task_id) throw "taskID must"
    let arr = this.getObjs()
    let i = arr.findIndex(v => v.data.task_id == obj.data.task_id)
    if (i > -1) arr[i] = obj
    else arr.push(obj)
    ss.set(this.localKey, arr)
    return this
  }

  public findIndex(id: string) {
    return this.getObjs().findIndex(v => v.data.task_id == id)
  }

  public getObjs(): SeedreamTask[] {
    const obj = ss.get(this.localKey) as undefined | SeedreamTask[]
    if (!obj) return []
    return obj
  }

  public getOneById(id: string): SeedreamTask | null {
    const i = this.findIndex(id)
    if (i < 0) return null
    let arr = this.getObjs()
    return arr[i]
  }

  public delete(id: string) {
    let arr = this.getObjs()
    let i = arr.findIndex(v => v.data.task_id == id)
    if (i < 0) return false
    arr.splice(i, 1)
    ss.set(this.localKey, arr)
    return true
  }
}
