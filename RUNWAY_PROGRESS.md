# Runway 视频生成平台 - 工作文档

**更新日期**: 2026-04-02

---

## 一、当前系统架构

### 服务结构
```
apps/web          → Vue 3 前端 (构建到 dist)
services/api      → Express API (:5102) - 任务创建、查询
services/worker   → BullMQ Worker - 任务提交、轮询
```

### 数据流
```
用户提交 → API 写 DB (pending) → 推入 BullMQ (runway-submit)
  → submit-worker 取出 → 检查并发 → 上传图片 → 调 Runway API
  → 推入 BullMQ (runway-poll) → poll-worker 轮询
  → 完成后写 DB (completed + resultUrl)
```

### 关键配置
- **Runway Token**: `.env` 的 `RUNWAY_TOKEN` + `RUNWAY_TEAM_ID`
- **多 Token**: `RUNWAY_TOKENS=tok1:teamId1,tok2:teamId2`
- **Redis**: `REDIS_URL` (token 冷却 key: `runway:token:cd:{tokenId}`)
- **DB**: PostgreSQL `runway_jobs` 表

---

## 二、已完成功能清单

### 核心功能
- [x] text2video 提交 → Runway kling_3_0_standard → 轮询完成
- [x] img2video 提交（图片上传到 Runway CDN）
- [x] 任务状态实时轮询（前端 5s 间隔）
- [x] 视频预览 + 下载
- [x] `usedToken` 字段记录每个任务使用的 token

### Token 管理
- [x] Redis token 冷却（429 后 60s 冷却）
- [x] 多 token 轮询选择（`token-pool.ts`）
- [x] `/api/runway/token-status` 端点（查看过期、冷却状态）
- [x] 前端 Token 警告 UI（每 30s 轮询）

### 并发控制
- [x] 提交前检测活跃任务数（`getActiveConcurrency()`）
- [x] 并发满时自动 requeue（+30s 延迟）
- [x] BullMQ 显式 requeue 替代 throw（避免 BullMQ 标记 failed）

### 前端
- [x] text2video / img2video 模式切换
- [x] 图片文件上传（base64 → API → Runway CDN）
- [x] 时长选择：5s / 10s / 15s
- [x] Explore Mode 开关
- [x] 任务列表 + 视频预览 + 下载

---

## 三、队列行为说明

### 单账号（2 并发槽）
提交 10 个任务时的行为：
1. 任务 1-2：立即进入 Runway（并发 2/2）
2. 任务 3-10：每次被 worker 取出 → 检测到并发满 → requeue +30s
3. 任务 1 或 2 完成后 → 下一个任务获得槽位并提交
4. **所有任务都会被处理，但等待时间线性增长**

### 多账号（2账号 × 2并发 = 4槽）
当前 token 轮询逻辑：选择"不在冷却中"的 token，但未优先选择空闲账号。

**待改进的多账号并发优化**（见第五节）

---

## 四、API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/runway/jobs` | 创建任务 |
| GET | `/api/runway/jobs` | 任务列表 |
| GET | `/api/runway/jobs/:id` | 任务详情 |
| POST | `/api/runway/jobs/:id/cancel` | 取消任务 |
| GET | `/api/runway/token-status` | Token 状态 |
| POST | `/api/runway/upload` | 上传图片（base64）|

### 创建任务 payload
```json
{
  "prompt": "...",
  "mode": "text2video" | "img2video",
  "imageUrl": "...",
  "duration": 5 | 10 | 15,
  "exploreMode": true
}
```

---

## 五、待优化：多账号并发队列架构

### 目标
- 2 个 Runway 账号（token A: 2并发, token B: 2并发）
- 总计 4 个并发槽
- 任务队列能智能分配到有空槽的账号

### 方案设计

#### 方案 A：Per-token 并发检测（推荐）
改进 `submit.worker.ts` 的 token 选择逻辑：

```typescript
// 当前：随机选不在冷却中的 token
const tok = await tokenPool.acquire();

// 改进：选择活跃任务数最少的 token
async acquireWithMinConcurrency(): Promise<TokenEntry | null> {
  const available = this.tokens.filter(t => !isInCooldown(t));
  if (!available.length) return null;
  
  // 查询每个 token 的活跃任务数
  const counts = await Promise.all(available.map(async t => {
    const client = new RunwayDirectClient(t.token, t.teamId);
    const active = await client.getActiveConcurrency();
    return { token: t, active };
  }));
  
  // 选活跃任务最少的
  const min = counts.reduce((a, b) => a.active < b.active ? a : b);
  return min.active < MAX_CONCURRENCY_PER_TOKEN ? min.token : null;
}
```

#### 方案 B：Redis 计数器（更高效，不依赖 API 查询）
```
runway:concurrency:{tokenId} → 当前活跃数
```
- 提交时 `INCR`，完成/失败时 `DECR`
- 无需查询 Runway API，直接从 Redis 读取

#### 当前配置（添加第二个账号）
```bash
# /root/runway/services/worker/.env
RUNWAY_TOKENS=token1:teamId1,token2:teamId2
# 或
RUNWAY_TOKEN=token1
RUNWAY_TEAM_ID=teamId1
```

---

## 六、前端待完善

### 已完成
- [x] 模式选择、时长选择、图片上传
- [x] 任务列表、视频预览、下载
- [x] Token 状态警告

### 待完善
- [ ] 任务列表分页（当前全量加载）
- [ ] 显示任务时长、模式信息
- [ ] 视频缩略图预览
- [ ] 任务失败时的重试按钮
- [ ] 上传进度条

---

## 七、已知问题 & 修复记录

| 问题 | 修复方法 |
|------|----------|
| resolution 错误（text2video 需要） | 加 `resolution: "1280x720"` |
| img2video 不能带 resolution | 改为 `referenceImages.length === 0` 时才加 |
| assetGroupId 随机 UUID → 404 | 删除该字段 |
| BullMQ retry 不工作 | 改为显式 `queue.add(delay)` + `return` |
| 多个旧 worker 进程同时运行 | 每次重启前 kill 所有旧进程 |
| API 静态文件 `/img/` | `express.static('/root/runway/uploads')` |
