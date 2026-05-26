# Progress Report: mac-process-monitor

*Last Updated: 2026-05-26 13:19 IST*

## Project Status: T1 Complete, T4 Nearly Complete, T2-T3-T5 Pending

### What Works
- **T1 — TypeScript Core Monitor**: ✅ COMPLETE
  - `SystemCollector.ts`: Battery + process + expanded metric sampling via `systeminformation`
  - `DrainAnalyzer.ts`: Sliding 5-min window drain detection with process correlation
  - `TimeSeriesDB.ts`: SQLite storage with WAL + auto-migration
  - `Monitor.ts`: Orchestrator loop with configurable intervals and thresholds
  - `main.ts`: Entry point with graceful SIGINT/SIGTERM shutdown
  - Test scripts: `test-basic.ts`, `test-collector.ts`, `test-analyzer.ts`, `show-data.ts`
  - Memory Bank: Full task registry, product context, tech context, edit history

- **T4 — Web Dashboard**: 🔄 NEARLY COMPLETE
  - `src/combined.ts`: Unified monitor + dashboard in single process (recommended)
  - `src/web/server.ts`: Standalone dashboard HTTP server
  - `web/public/`: HTML + vanilla JS + CSS dark theme
  - 9 API endpoints: snapshot, history, drain-events, process-history, process-stats, top-processes, profiles, db-size, server-info
  - Chart tabs: Battery/CPU/Memory SVG line charts with gradient fill
  - DB size badge (`🗄`) and uptime badge (`⏱`)
  - Profile filtering with persistent sort state
  - Auto-refresh every 5 seconds
  - Mobile-responsive process table with horizontal scroll

### What's In Progress
- T4: Dashboard polish — potential minor UI refinements

### What's Left to Build
| Task | Status | Description |
|------|--------|-------------|
| T2 | ⬜ | Telegram/OpenClaw alert integration (HIGH priority) |
| T3 | ⬜ | Per-process history query interface (CLI tool) |
| T5 | ⬜ | Swift menubar app (future) |

## Technical Debt
- `techContext.md` was stale (described old Python stack) — **FIXED** 2026-05-19
- `productContext.md` was generic — **FIXED** 2026-05-19 to describe battery drain use case

## Known Issues
- `sendAlert()` in `Monitor.ts` is a stub — prints to console, doesn't actually send messages (T2 will fix)
- No formal test framework (Jest configured but no test files written)
- `.js` import paths in source are ESM convention but look odd
- Previous LaunchAgent crashed 4,427 times — removed, manual start recommended

## Timeline

| Date | Milestone | Status |
|------|-----------|--------|
| 2026-05-18 | T1: TypeScript rewrite with core monitoring | ✅ Complete |
| 2026-05-18 | Memory bank initialized, T2-T5 planned | ✅ Complete |
| 2026-05-19 | Memory bank updated to reflect actual TS stack | ✅ Complete |
| 2026-05-19 | T4: Web dashboard on port 3456 with Chart.js | ✅ Complete |
| 2026-05-26 | T4: Unified process, chart tabs, badges, profile filtering | 🔄 Complete |
| *Next* | T2: OpenClaw/Telegram alerting | ⬜ Pending |
| *Next* | T3: CLI query tool (`--process Chrome --since 2h`) | ⬜ Pending |
| *Future* | T5: Swift menubar | ⬜ Pending |

## Current Blockers
- None

## Next Milestone Goals
- Wire `Monitor.sendAlert()` to actually dispatch messages (T2)
- Build `src/query.ts` CLI for per-process history (T3)
- Port core logic to Swift menubar app (T5)

## Notes
- Project was rewritten from Python to TypeScript during T1
- Original `procmon/` Python package is vestigial (not imported by TS code)
- `requirements.txt` and `procmon/` can be removed once TS stack is fully validated