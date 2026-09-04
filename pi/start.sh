#!/usr/bin/env bash
# Start / restart the signer in the background. Usage: ./start.sh http://<mac-ip>:3000 [extra signer flags]
set -e
cd "$(dirname "$0")"
APP="${1:-${CHIP_APP_URL:-http://localhost:3000}}"; shift || true
if [ -f signer.pid ] && kill -0 "$(cat signer.pid)" 2>/dev/null; then kill "$(cat signer.pid)"; sleep 1; fi
setsid nohup python3 signer.py run --app "$APP" --name "$(hostname)" "$@" > signer.log 2>&1 < /dev/null &
echo $! > signer.pid
sleep 3
echo "pid $(cat signer.pid)"; tail -n 8 signer.log
