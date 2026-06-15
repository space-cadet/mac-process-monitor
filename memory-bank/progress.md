# Progress Report: mac-process-monitor

*Last Updated: 2026-06-10 01:15 IST*

## Project Status: T1, T3, T4, T6, T7 Complete; T2, T5 Pending

### What Works

- **T1 — TypeScript Core Monitor**: ✅ COMPLETE
  - `SystemCollector.ts`: Battery + process + expanded metric sampling via `systeminformation`
  - `DrainAnalyzer.ts`: Sliding window drain detection with process correlation
  - `TimeSeriesDB.ts`: SQLite storage with WAL + auto-migration (6 tables)
  - `Monitor.ts`: Orchestrator loop with configurable intervals and thresholds
  - `main.ts`: Entry point with graceful SIGINT/SIGTERM shutdown
  - Test scripts: `test-basic.ts`, `test-collector.ts`, `test-analyzer.ts`, `show-data.ts`

- **T3 — Per-Process Query Interface**: ✅ COMPLETE
  - `src/query.ts`: CLI tool with `--spikes`, `--battery`, `--top`, `--process`, `--stats`
  - `TimeSeriesDB.ts`: Query methods for history, stats, top processes, spikes, battery impact
  - All queries exposed via dashboard API endpoints

- **T4 — Web Dashboard**: ✅ COMPLETE (rebuilt 2026-06-10)
  - `src/dashboard/server.ts`: Native Node.js HTTP server, 12 API endpoints
  - `dashboard/public/`: 7-file modular frontend (HTML, CSS, utils, charts, tables, profiles, app)
  - Features: side-by-side layout, sortable columns, process detail modal, spike panel, battery impact panel, profile CRUD
  - Auto-refresh every 5 seconds, responsive design
  - Playwright E2E tests

- **T6 — Process Spike Detection**: ✅ COMPLETE
  - `src/core/SpikeDetector.ts`: Per-process baseline tracking, dual-threshold detection
  - `process_spikes` table: Stores spike events with baseline, threshold, snapshot reference
  - Dashboard: Real-time spike alert panel with clickable cards
  - CLI: `npx tsx src/query.ts --spikes --since 1h`

- **T7 — Battery Impact Correlation**: ✅ COMPLETE
  - `src/core/BatteryImpactAnalyzer.ts`: Drain period detection, per-process impact scoring
  - `battery_impact` + `battery_impact_events` tables: Accumulated scores + event history
  - Dashboard: Battery impact ranking bars with clickable process links
  - CLI: `npx tsx src/query.ts --battery --limit 10`

### What's Left to Build

| Task | Status | Description |
|------|--------|-------------|
| T2 | ⬜ | Telegram/OpenClaw alert integration |
| T5 | ⬜ | Swift menubar app (future) |

### Technical Debt (Resolved)

- ~~`techContext.md` was stale~~ — **FIXED** 2026-05-19
- ~~`productContext.md` was generic~~ — **FIXED** 2026-05-19
- ~~Dashboard frontend regression~~ — **FIXED** 2026-06-10 (advanced features restored)
- ~~Process modal `[object Object]` bug~~ — **FIXED** 2026-06-10 (click handler passed object instead of name)

### Known Issues

- `sendAlert()` in `Monitor.ts` is still a stub — prints to console, doesn't actually send messages (T2 pending)
- No formal test framework (Jest configured but no test files written)
- Battery impact data needs longer runtime on battery power (currently 0 events — needs 2% drop over 2+ min while not charging)

### Timeline

| Date | Milestone | Status |
|------|-----------|--------|
| 2026-05-18 | T1: TypeScript rewrite with core monitoring | ✅ Complete |
| 2026-05-18 | Memory bank initialized, T2-T5 planned | ✅ Complete |
| 2026-05-19 | Memory bank updated to reflect actual TS stack | ✅ Complete |
| 2026-05-19 | T4: Web dashboard on port 3456 with Chart.js | ✅ Complete |
| 2026-06-09 | T6: Process spike detection with baseline tracking | ✅ Complete |
| 2026-06-09 | T7: Battery impact correlation with scoring | ✅ Complete |
| 2026-06-10 | T4: Dashboard rebuilt with full features + T3 queries | ✅ Complete |
| *Next* | T2: OpenClaw/Telegram alerting | ⬜ Pending |
| *Future* | T5: Swift menubar | ⬜ Pending |

### Current Blockers

- None

### Next Milestone Goals

- Wire `Monitor.sendAlert()` to actually dispatch messages via OpenClaw message tool (T2)
- Restart monitor core for continuous sampling (stopped after test run)
- Capture dashboard screenshots for README

### Notes

- Project rewritten from Python to TypeScript during T1
- Original `procmon/` Python package is vestigial (not imported by TS code)
- `requirements.txt` and `procmon/` can be removed once TS stack is fully validated
- Memory bank uses BOTH workflows: DB-native (`database/`) + text-based (`tasks.md`, `T*.md`, etc.)
- GitHub repo made public: https://github.com/space-cadet/mac-process-monitor
