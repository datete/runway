#!/usr/bin/env bash
set -euo pipefail

LOG=${RUNWAY_GUARD_LOG:-/var/log/runway-guard.log}
HISTORY_LIMIT=${BULLMQ_HISTORY_LIMIT:-1000}
POLL_KEY_WARN=${RUNWAY_POLL_KEY_WARN:-5000}
REDIS_WARN_PCT=${RUNWAY_REDIS_WARN_PCT:-80}
DISK_WARN_PCT=${RUNWAY_DISK_WARN_PCT:-85}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
}

redis_num() {
  redis-cli "$@" 2>/dev/null | tail -1 | tr -d '\r' || printf '0'
}

trim_queue_history() {
  local queue="$1"
  local prefix="bull:${queue}"
  local completed failed remove_count last_old_rank

  completed=$(redis_num ZCARD "${prefix}:completed")
  if [ "${completed:-0}" -gt 0 ]; then
    redis-cli ZRANGE "${prefix}:completed" 0 -1 2>/dev/null \
      | awk -v p="${prefix}:" 'NF { print p $0 }' \
      | xargs -r -n 500 redis-cli DEL >/dev/null
    redis-cli DEL "${prefix}:completed" >/dev/null || true
    log "trimmed ${queue} completed history: ${completed} jobs"
  fi

  failed=$(redis_num ZCARD "${prefix}:failed")
  if [ "${failed:-0}" -gt "$HISTORY_LIMIT" ]; then
    remove_count=$((failed - HISTORY_LIMIT))
    last_old_rank=$((remove_count - 1))
    redis-cli ZRANGE "${prefix}:failed" 0 "$last_old_rank" 2>/dev/null \
      | awk -v p="${prefix}:" 'NF { print p $0 }' \
      | xargs -r -n 500 redis-cli DEL >/dev/null
    redis-cli ZREMRANGEBYRANK "${prefix}:failed" 0 "$last_old_rank" >/dev/null || true
    log "trimmed ${queue} failed history: removed ${remove_count}, kept ${HISTORY_LIMIT}"
  fi

  redis-cli XTRIM "${prefix}:events" MAXLEN '~' "$HISTORY_LIMIT" >/dev/null 2>&1 || true
}

if ! redis-cli PING >/dev/null 2>&1; then
  log "ERROR redis ping failed"
  exit 0
fi

used=$(redis-cli INFO memory | awk -F: '/^used_memory:/ { gsub(/\r/, "", $2); print $2 }')
max=$(redis-cli CONFIG GET maxmemory | awk 'NR == 2 { print $1 }')
if [ -z "${max:-}" ] || [ "$max" -eq 0 ]; then max=1; fi
pct=$((used * 100 / max))
poll_keys=$(redis-cli --scan --pattern 'bull:runway-poll:*' | wc -l | tr -d ' ')
submit_keys=$(redis-cli --scan --pattern 'bull:runway-submit:*' | wc -l | tr -d ' ')
disk_pct=$(df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')

trim_queue_history runway-poll
trim_queue_history runway-submit

if [ "$pct" -ge "$REDIS_WARN_PCT" ] || [ "$poll_keys" -ge "$POLL_KEY_WARN" ] || [ "$disk_pct" -ge "$DISK_WARN_PCT" ]; then
  log "WARN redis_used_pct=${pct} poll_keys=${poll_keys} submit_keys=${submit_keys} disk_pct=${disk_pct}"
  redis-cli MEMORY PURGE >/dev/null 2>&1 || true
else
  log "OK redis_used_pct=${pct} poll_keys=${poll_keys} submit_keys=${submit_keys} disk_pct=${disk_pct}"
fi
