#!/usr/bin/env bash
set -euo pipefail
redis-cli mset borrow:dispatch:enabled 0 borrow:provider:enabled 0 >/dev/null
echo "Borrow dispatch/provider switches disabled."
