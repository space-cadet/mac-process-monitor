# Active Context

*Last Updated: 2026-06-10 01:15 IST*

## Current Tasks

No active tasks. All core features (T1, T3, T4, T6, T7) are complete. Only T2 (alerting) and T5 (Swift menubar) remain pending.

## Completed Tasks (Recent)
- **T6: Process Spike Detection** (2026-06-09) — Per-process baseline tracking, dual-threshold detection, DB storage, CLI queries, dashboard integration
- **T7: Battery Impact Correlation** (2026-06-09) — Drain period detection, per-process impact scoring, accumulated rankings, CLI + dashboard
- **T4: Web Dashboard Rebuild** (2026-06-10) — Modular 7-file frontend, side-by-side layout, sortable columns, process modal, spike panel, battery impact panel, profiles CRUD, 12 API endpoints
- **T3: Per-Process Query Interface** (2026-06-10) — CLI tool with `--spikes`, `--battery`, `--top`, `--process`, `--stats` options, all exposed via dashboard API

## Next Steps
- **T2: Telegram/OpenClaw Alert Integration** — Wire `Monitor.sendAlert()` to actually dispatch messages via OpenClaw message tool or Telegram bot
- **T5: Swift Menubar App** — Port proven TypeScript logic to Swift after T2 stable

## System Status
- **Battery**: Varies (monitoring active)
- **Memory**: Normal
- **DB**: `~/.procmon/monitor.db` with 6 tables: snapshots, process_samples, drain_events, process_spikes, battery_impact, battery_impact_events
- **Dashboard**: Running on http://localhost:3456 (auto-refresh every 5s)
- **Monitor**: Stopped after test run — needs restart for continuous sampling
- **GitHub Repo**: https://github.com/space-cadet/mac-process-monitor (public)
