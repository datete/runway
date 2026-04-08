// Reduces an SSE event stream into a flat list of renderable "messages" for one task.
// Messages are kept in chronological order; rounds are grouped; thinking tokens accumulate per itemId.

export type ItemStatus = 'queued' | 'generating' | 'generated' | 'reviewing' | 'passed' | 'rejected' | 'failed'

export interface ItemState {
  itemId: string
  round: number
  status: ItemStatus
  percent?: number
  imageUrl?: string
  reason?: string
  suggestions?: string[]
  pass?: boolean
}

export interface RoundMessage {
  kind: 'round'
  round: number
  batchSize: number
  hint?: string
  items: ItemState[]
  passed?: number
  rejected?: number
  failed?: number
  ended?: boolean
}

export interface AnalysisMessage {
  kind: 'analysis'
  round: number
  topReasons: { reason: string; count: number }[]
  rewrittenPromptHint?: string
}

export interface StatusMessage {
  kind: 'status'
  level: 'info' | 'success' | 'warn' | 'error'
  text: string
  ts: number
}

export interface IntroMessage {
  kind: 'intro'
  text: string
}

export interface FinalMessage {
  kind: 'final'
  status: 'done' | 'partial' | 'error'
  passed: number
  message?: string
  images: string[]
}

export type AgentMessage =
  | IntroMessage
  | RoundMessage
  | AnalysisMessage
  | StatusMessage
  | FinalMessage

export interface ReducerState {
  messages: AgentMessage[]
  thinkingByItem: Record<string, string>
  passedImages: string[]
  terminal: boolean
}

export function createReducerState(): ReducerState {
  return {
    messages: [],
    thinkingByItem: {},
    passedImages: [],
    terminal: false,
  }
}

function currentRound(state: ReducerState, round: number): RoundMessage | null {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i]
    if (m.kind === 'round' && m.round === round) return m
  }
  return null
}

function findItem(round: RoundMessage | null, itemId: string): ItemState | undefined {
  return round?.items.find((x) => x.itemId === itemId)
}

function findAnyItem(state: ReducerState, itemId: string): { round: RoundMessage; item: ItemState } | null {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i]
    if (m.kind === 'round') {
      const it = m.items.find((x) => x.itemId === itemId)
      if (it) return { round: m, item: it }
    }
  }
  return null
}

export function applyEvent(state: ReducerState, event: string, data: any): ReducerState {
  switch (event) {
    case 'round_start': {
      state.messages.push({
        kind: 'round',
        round: data.round,
        batchSize: data.batchSize,
        hint: data.hint,
        items: [],
      })
      state.messages.push({
        kind: 'status',
        level: 'info',
        text: `Round ${data.round} 开始 · 计划生成 ${data.batchSize} 张`,
        ts: Date.now(),
      })
      break
    }
    case 'item_queued': {
      const r = currentRound(state, data.round)
      if (r && !findItem(r, data.itemId)) {
        r.items.push({ itemId: data.itemId, round: data.round, status: 'queued' })
      }
      break
    }
    case 'seedream_progress': {
      const found = findAnyItem(state, data.itemId)
      if (found) {
        found.item.status = 'generating'
        found.item.percent = data.percent
      }
      break
    }
    case 'seedream_done': {
      const found = findAnyItem(state, data.itemId)
      if (found) {
        found.item.status = 'generated'
        found.item.imageUrl = data.imageUrl
        found.item.percent = 100
      }
      break
    }
    case 'review_start': {
      const found = findAnyItem(state, data.itemId)
      if (found) found.item.status = 'reviewing'
      if (!state.thinkingByItem[data.itemId]) state.thinkingByItem[data.itemId] = ''
      break
    }
    case 'review_token': {
      const prev = state.thinkingByItem[data.itemId] || ''
      state.thinkingByItem = { ...state.thinkingByItem, [data.itemId]: prev + (data.delta || '') }
      break
    }
    case 'review_done': {
      const found = findAnyItem(state, data.itemId)
      if (found) {
        found.item.pass = data.pass
        found.item.reason = data.reason
        found.item.suggestions = data.suggestions
      }
      break
    }
    case 'item_passed': {
      const found = findAnyItem(state, data.itemId)
      if (found) {
        found.item.status = 'passed'
        if (data.imageUrl) found.item.imageUrl = data.imageUrl
        const url = data.imageUrl || found.item.imageUrl
        if (url && !state.passedImages.includes(url)) state.passedImages.push(url)
      }
      break
    }
    case 'item_rejected': {
      const found = findAnyItem(state, data.itemId)
      if (found) {
        found.item.status = 'rejected'
        if (data.reason) found.item.reason = data.reason
      }
      break
    }
    case 'round_end': {
      const r = currentRound(state, data.round)
      if (r) {
        r.passed = data.passed
        r.rejected = data.rejected
        r.failed = data.failed
        r.ended = true
      }
      state.messages.push({
        kind: 'status',
        level: 'info',
        text: `Round ${data.round} 结束 · ${data.passed} 通过 / ${data.rejected} 拒绝 / ${data.failed} 失败`,
        ts: Date.now(),
      })
      break
    }
    case 'reject_analysis': {
      state.messages.push({
        kind: 'analysis',
        round: data.round,
        topReasons: data.topReasons || [],
        rewrittenPromptHint: data.rewrittenPromptHint,
      })
      break
    }
    case 'task_done': {
      state.terminal = true
      state.messages.push({
        kind: 'final',
        status: 'done',
        passed: state.passedImages.length,
        images: [...state.passedImages],
      })
      break
    }
    case 'task_partial': {
      state.terminal = true
      state.messages.push({
        kind: 'final',
        status: 'partial',
        passed: state.passedImages.length,
        message: data?.message,
        images: [...state.passedImages],
      })
      break
    }
    case 'error': {
      state.terminal = true
      state.messages.push({
        kind: 'final',
        status: 'error',
        passed: state.passedImages.length,
        message: data?.message || '任务失败',
        images: [...state.passedImages],
      })
      break
    }
    case 'close': {
      state.terminal = true
      break
    }
  }
  return state
}
