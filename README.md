# Runway 视频生成平台

基于 [Runway Gen-4](https://runwayml.com/) 的 AI 视频生成服务，支持 text2video 和 img2video，通过 BullMQ 任务队列实现异步并发处理。

## 项目架构

```
apps/
  web/              → Vue 3 前端 (ChatGPT Web Midjourney Proxy 界面)
services/
  api/              → Express API 服务 (:5102) — 任务创建、查询
  worker/           → BullMQ Worker — 任务提交、轮询 Runway
packages/
  shared/           → 共享类型/工具
```

## 数据流

```
用户提交
  → API 写 DB (pending)
  → 推入 BullMQ (runway-submit)
  → submit-worker: 检查并发 → 上传图片 → 调 Runway API
  → 推入 BullMQ (runway-poll)
  → poll-worker: 轮询状态
  → 完成后写 DB (completed + resultUrl)
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript |
| API | Express + TypeScript |
| 任务队列 | BullMQ (Redis) |
| 数据库 | PostgreSQL + Prisma |
| 运行时 | Node.js 18+ / pnpm |
| 部署 | systemd + Nginx 反向代理 |

## 快速开始

### 环境要求

- Node.js 18+
- pnpm
- PostgreSQL
- Redis

### 安装

```bash
git clone https://github.com/datete/runway.git
cd runway
pnpm install
```

### 配置

复制环境变量模板并填写：

```bash
cp .env.example .env
```

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `REDIS_URL` | Redis 连接地址 |
| `RUNWAY_TOKEN` | Runway API JWT Token |
| `RUNWAY_TEAM_ID` | Runway 团队 ID |
| `RUNWAY_TOKENS` | 多 Token: `tok1:teamId1,tok2:teamId2` |
| `RUNWAY_DEFAULT_MODEL` | 默认模型 (gen4) |
| `RUNWAY_EXPLORE_MODE` | Explore 模式开关 |
| `API_PORT` | API 端口 (默认 5102) |

### 数据库初始化

```bash
cd services/api
npx prisma migrate deploy
```

### 启动服务

```bash
# API 服务
pnpm --filter @runway/api start

# Worker 服务
pnpm --filter @runway/worker start
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/runway/submit` | 提交视频生成任务 |
| GET | `/api/runway/jobs` | 查询任务列表 |
| GET | `/api/runway/jobs/:id` | 查询单个任务状态 |
| GET | `/api/runway/token-status` | 查看 Token 冷却状态 |

## 并发控制

- 单 Token: 2 并发槽
- 多 Token: N 账号 × 2 并发槽
- 429 限速后 Token 自动进入 60s 冷却
- 并发满时任务自动 requeue (+30s 延迟)

## License

MIT
