#!/bin/bash
set -e
cd /root/runway

# 检查是否有变化
git add -A
if git diff --cached --quiet; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] No changes to sync"
    exit 0
fi

# 提交并推送
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
git commit -m "auto: sync ${TIMESTAMP}"
git push
echo "[${TIMESTAMP}] Sync completed"
