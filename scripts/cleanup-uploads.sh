#!/usr/bin/env bash
set -euo pipefail
UPLOADS=/root/runway/uploads
DAYS=${UPLOAD_CACHE_DAYS:-3}
MAX_GB=${UPLOAD_CACHE_MAX_GB:-25}
LOG=/root/runway/cleanup-uploads.log

max_bytes=$((MAX_GB * 1024 * 1024 * 1024))
ts="$(date '+%Y-%m-%d %H:%M:%S')"
before=$(du -sb "$UPLOADS" 2>/dev/null | awk '{print $1}')

age_count=$(find "$UPLOADS" -type f -mtime +"$DAYS" 2>/dev/null | wc -l)
find "$UPLOADS" -type f -mtime +"$DAYS" -delete 2>/dev/null || true

after_age=$(du -sb "$UPLOADS" 2>/dev/null | awk '{print $1}')
cap_count=0
if [ "${after_age:-0}" -gt "$max_bytes" ]; then
  current=$after_age
  while read -r _ size file; do
    [ -n "${file:-}" ] || continue
    rm -f "$file" 2>/dev/null || true
    cap_count=$((cap_count + 1))
    current=$((current - size))
    [ "$current" -le "$max_bytes" ] && break
  done < <(find "$UPLOADS" -type f -printf '%T@ %s %p\n' 2>/dev/null | sort -n)
fi

after=$(du -sb "$UPLOADS" 2>/dev/null | awk '{print $1}')
freed_mb=$(( (before - after) / 1024 / 1024 ))

echo "[$ts] age_deleted=$age_count cap_deleted=$cap_count freed_MB=$freed_mb max_GB=$MAX_GB size_before=$before size_after=$after" >> "$LOG"
