#!/bin/bash
# Check if mac-process-monitor and dashboard are running, start if not

MONITOR_LOG="/Users/sage/.openclaw/workspace/code/mac-process-monitor/logs/auto-start.log"

cd /Users/sage/.openclaw/workspace/code/mac-process-monitor

# Check monitor
if ! pgrep -f "tsx.*src/main.ts" > /dev/null 2>&1; then
    bash run.sh > /dev/null 2>&1 &
    echo "$(date): mac-process-monitor started" >> "$MONITOR_LOG"
fi

# Check dashboard
if ! pgrep -f "tsx.*src/web/server.ts" > /dev/null 2>&1; then
    /usr/local/bin/npx tsx src/web/server.ts >> logs/dashboard.log 2>> logs/dashboard-error.log &
    echo "$(date): dashboard started" >> "$MONITOR_LOG"
fi
