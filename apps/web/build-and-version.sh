#!/bin/bash
cd /root/runway/apps/web
npx vite build
# Generate version.json after build
echo "{\"v\":\"$(date +%s)\"}" > dist/version.json
echo "✓ version.json created: $(cat dist/version.json)"
