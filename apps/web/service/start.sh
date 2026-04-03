#!/bin/bash
cd /root/runway/apps/web/service
exec node -e "require('./node_modules/tsx/dist/cjs/index.cjs'); require('./src/index.ts')"
