# Borrow Orchestration

This document describes the main-controller / child-controller borrow-compute design for Runway tasks.

## Roles

- Main controller: `keling.iplcz.cn`
  - Owns the visible task queue and normal admin UI.
  - Decides when to borrow redundant capacity from child systems.
  - Shows global redundancy, child status, active borrowed dispatches, and completed borrowed tasks as normal main-system tasks.
- Child controller: `81.70.250.85`
  - Keeps its own accounts, queue, risk controls, cooldowns, and submit/poll workers.
  - Exposes only borrow capacity and borrowed shadow-job lifecycle APIs.
  - Hides borrowed shadow jobs from normal user/admin task lists; the child UI only shows channel occupancy through capacity reporting.

## Trust Model

Borrow APIs are direct controller-to-controller APIs and do not use a borrow key. Keep child borrow endpoints reachable only from trusted infrastructure through firewall or private network rules.

Endpoints mounted on each controller:

- `GET /api/runway/borrow/capacity`
- `POST /api/runway/borrow/control`
- `POST /api/runway/borrow/jobs`
- `GET /api/runway/borrow/jobs/:dispatchId`
- `POST /api/runway/borrow/jobs/:dispatchId/cancel`

## Switches

Redis keys control runtime behavior without redeploying:

- `borrow:dispatch:enabled`: main controller dispatch switch. `1` enables borrowing outbound tasks. Turning it off stops new dispatches only; active borrowed jobs are still polled until they complete or fail.
- `borrow:dispatch:max-global`: global borrowed in-flight limit across all child systems.
- `borrow:dispatch:pending-threshold`: only borrow when the main queue has at least this many pending/queued jobs.
- `borrow:dispatch:local-usage-threshold`: only borrow when local account usage percentage reaches this threshold.
- `borrow:provider:enabled`: local provider switch. When enabled, this controller can accept borrowed shadow jobs.
- `borrow:provider:max-concurrency`: maximum borrowed shadow jobs this controller will accept.
- `borrow:provider:reserve-slots`: local free slots reserved for this controller's own jobs.

The admin Borrow Compute panel can change the main dispatch switch, global limits, local provider switch, and child provider switches. Child systems also have a local registry switch so the main controller can ignore a child without changing the child itself.

## Capacity And Risk Logic

Capacity is calculated on the child controller from its own accounts and Redis concurrency counters:

```text
freeSlots = total active account slots - currently used account slots
channelOccupied = borrowedShadowActive + borrowedShadowPending
availableSlots = min(providerMaxConcurrency - channelOccupied, freeSlots - providerReserveSlots)
```

A child returns zero available slots if its provider switch is off. The child still applies its own cooldowns, account concurrency, proxy behavior, submit worker pacing, and polling logic. Borrowed shadow jobs are marked with `provider = 'borrowed'` and `execution_mode = 'borrowed_shadow'`, so normal local queues and admin task views do not display them.

The main controller also protects the whole system:

- It only borrows when local backlog and local usage thresholds are met.
- It caps global borrowed in-flight jobs with `borrow:dispatch:max-global`.
- It caps each child with `borrow_systems.max_inflight`.
- It returns a job to the local queue if dispatch fails, polling times out, the child ends in a terminal non-success status, or the child stays without a remote task id for too long.
- Child borrowed shadow jobs that enter `submitted` without a remote task id are recovered back to the child queue after a short borrowed-task timeout.
- It enters a short global borrow cooldown after repeated child dispatch failures.

## Display Rules

Main controller UI:

- Shows global redundant slots, free child slots, enabled child count, active borrowed dispatch count, and child status.
- Shows borrowed tasks as normal main tasks with a `借调算力` badge on task cards and admin job rows.
- Shows each child system with animated channel occupancy and a child provider switch.

Child controller UI:

- Does not show borrowed shadow jobs in normal task/admin lists.
- Shows only capacity/channel occupancy through borrow capacity reporting.

## Default Deployment

Current intended topology:

- `keling.iplcz.cn`: main controller, dispatch switch defaults off until manually enabled.
- `81.70.250.85`: child controller, provider switch defaults on, registered in the main controller as `81-subcontrol`.

Runtime concurrency semantics:

- `borrow:dispatch:max-global=10` means the main controller can hold up to 10 active borrowed dispatches across all child controllers.
- `borrow_systems.max_inflight=10` on `81-subcontrol` means that child can hold up to 10 active main-controller borrowed tasks.
- `borrow:provider:max-concurrency=10` on the child means the child accepts up to 10 borrowed shadow jobs, reduced by current borrowed channel occupancy and local reserve slots.
- These are submitted Runway tasks, not guaranteed active rendering slots on Runway; Runway may still keep them in platform queue with progress 0.

Recommended defaults:

```bash
# main controller
redis-cli mset borrow:dispatch:enabled 0 borrow:provider:enabled 0 borrow:dispatch:max-global 10 borrow:dispatch:pending-threshold 20 borrow:dispatch:local-usage-threshold 70

# child controller
redis-cli mset borrow:dispatch:enabled 0 borrow:provider:enabled 1 borrow:provider:max-concurrency 10 borrow:provider:reserve-slots 2
```

## Rollback

The schema migration is additive except for the removal of the unused `borrow_systems.api_key` column. Runtime switches default to off on the main controller, so the lowest-risk rollback is:

```bash
redis-cli set borrow:dispatch:enabled 0
systemctl restart runway-worker.service
```

A full rollback can run the generated rollback SQL and restore the backed-up files from the timestamped `backups/borrow_*` directories. Stop API and worker services before replacing files, then restart both services and verify `/ready`.