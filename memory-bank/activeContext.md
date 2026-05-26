# Active Context

*Last Updated: 2026-05-26 13:19 IST*

## Current Tasks

1. **[T4]**: Web Dashboard for Live Monitoring (MEDIUM priority)
   - Status: 🔄 IN PROGRESS
   - Output: `src/combined.ts` runs monitor + dashboard in single process
   - Server on port 3456, DB actively recording (2,976 snapshots, 148,800 process samples)
   - Chart tabs (Battery/CPU/Memory) all plotting live SVG line charts
   - DB size badge (`🗄`) and uptime badge (`⏱`) in header
   - Profile filtering with persistent sort state
   - Files: `src/combined.ts`, `src/web/server.ts`, `web/public/app.js`, `web/public/index.html`, `web/public/styles.css`

2. **[T2]**: Telegram/OpenClaw Alert Integration (HIGH priority)
   - Status: ⬜ PENDING
   - Next: Wire `sendAlert()` in Monitor.ts to dispatch messages via Telegram bot or OpenClaw

3. **[T3]**: Per-Process History Query Interface (MEDIUM priority)
   - Status: ⬜ PENDING
   - Next: Build CLI tool (`npx tsx src/query.ts --process Chrome --since 2h`)
   - Note: `combined.ts` already has `/api/process-history` and `/api/process-stats` endpoints

4. **[T5]**: Swift Menubar App (LOW priority)
   - Status: ⬜ PENDING
   - Next: Port proven TypeScript logic to Swift after T2-T4 stable

## Completed Tasks (Recent)
- T1: TypeScript rewrite — battery, process tracking, drain detection, SQLite storage (2026-05-18)

## Next Steps
- T2: Telegram alerting — integrate OpenClaw message tool or node-telegram-bot-api
- T3: Process queries — CLI tool for per-process history analysis
- T5: Swift menubar — native macOS app (future)

## System Status
- **Battery**: Monitoring via `systeminformation`
- **DB**: `~/.procmon/monitor.db` with snapshots + process samples
- **Dashboard**: Running on http://localhost:3456 (via `npx tsx src/combined.ts`)
- **Monitor**: Running within `combined.ts`, sampling every 30s
