import { homeStore } from "@/store"
import { mlog } from "./mjapi"
import { SeedreamTask, seedreamStore } from "./seedreamStore"
import { gptFetch } from "./openapi"

export const seedreamGenerate = async (payload: any, prompt: string, negPrompt?: string) => {
  const store = new seedreamStore()
  mlog('seedreamGenerate', payload)

  try {
    const d: any = await gptFetch('/v1/images/generations', payload)
    mlog('seedream response', d)

    // Handle OpenAI-compatible response format
    if (d.data && Array.isArray(d.data)) {
      // Synchronous response: images returned directly
      const taskId = d.created?.toString() || Date.now().toString()
      const images = d.data.map((img: any, idx: number) => ({
        index: idx,
        url: img.url || (img.b64_json ? 'data:image/png;base64,' + img.b64_json : '')
      }))

      const task: SeedreamTask = {
        cat: 'image',
        prompt: prompt,
        negative_prompt: negPrompt,
        model: payload.model,
        size: payload.size,
        quality: payload.quality,
        n: payload.n,
        last_feed: Date.now(),
        code: 0,
        message: 'success',
        request_id: taskId + '_' + Math.random().toString(36).slice(2, 8),
        data: {
          task_id: taskId + '_' + Math.random().toString(36).slice(2, 8),
          task_status: 'succeed',
          task_status_msg: '',
          created_at: Date.now(),
          updated_at: Date.now(),
          task_result: { images }
        }
      }
      store.save(task)
      homeStore.setMyData({ act: 'SeedreamFeed' })
      return task
    }

    // Async response with task_id (kling-style)
    if (d.data?.task_id) {
      const task = d as SeedreamTask
      task.cat = 'image'
      task.prompt = prompt
      task.negative_prompt = negPrompt
      task.model = payload.model
      task.size = payload.size
      task.quality = payload.quality
      task.n = payload.n
      task.last_feed = Date.now()
      store.save(task)
      homeStore.setMyData({ act: 'SeedreamFeed' })
      return task
    }

    throw new Error('Unexpected response format')
  } catch (e: any) {
    mlog('seedream error', e)
    throw e
  }
}
