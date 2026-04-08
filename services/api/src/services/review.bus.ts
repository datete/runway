// review.bus.ts — global event bus for review SSE
import { EventEmitter } from "events";
import { prisma } from "./prisma";

export const reviewBus = new EventEmitter();
reviewBus.setMaxListeners(0);

export type ReviewEventType =
  | "round_start"
  | "item_queued"
  | "seedream_progress"
  | "seedream_done"
  | "review_start"
  | "review_token"
  | "review_done"
  | "item_passed"
  | "item_rejected"
  | "round_end"
  | "reject_analysis"
  | "task_done"
  | "task_partial"
  | "error";

export async function emitReviewEvent(args: {
  taskId: string;
  itemId?: string | null;
  round?: number | null;
  type: ReviewEventType;
  payload?: any;
  persist?: boolean; // default true; review_token may be persist:false
}) {
  const persist = args.persist !== false;
  let row: any = null;
  try {
    if (persist) {
      row = await prisma.reviewEvent.create({
        data: {
          taskId: args.taskId,
          itemId: args.itemId || null,
          round: args.round ?? null,
          type: args.type,
          payload: (args.payload || null) as any,
        },
      });
    }
  } catch (e: any) {
    console.error("[review.bus] persist error:", e?.message);
  }
  const flat = (args.payload && typeof args.payload === 'object' && !Array.isArray(args.payload)) ? args.payload : {};
  const evt: any = {
    ...flat,
    id: row?.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    taskId: args.taskId,
    itemId: args.itemId || (flat as any).itemId || null,
    round: args.round ?? (flat as any).round ?? null,
    type: args.type,
    payload: args.payload || null,
    createdAt: row?.createdAt || new Date(),
  };
  reviewBus.emit(`task:${args.taskId}`, evt);
  return evt;
}
