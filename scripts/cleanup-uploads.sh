#!/usr/bin/env bash
set -euo pipefail
UPLOADS=/root/runway/uploads
DAYS=3
LOG=/root/runway/cleanup-uploads.log

ts="$(date '+%Y-%m-%d %H:%M:%S')"
before=$(du -sb "$UPLOADS" 2>/dev/null | awk '{print $1}')
count=$(find "$UPLOADS" -type f -mtime +$DAYS 2>/dev/null | wc -l)
find "$UPLOADS" -type f -mtime +$DAYS -delete 2>/dev/null || true
after=$(du -sb "$UPLOADS" 2>/dev/null | awk '{print $1}')
freed_mb=$(( (before - after) / 1024 / 1024 ))

echo "[$ts] deleted=$count freed_MB=$freed_mb size_before=$before size_after=$after" >> "$LOG"
