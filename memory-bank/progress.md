# Progress Report: mac-process-monitor

*Last Updated: 2026-06-19 00:52 IST*

## Project Status: T1-T8 Complete + T4 Extended; T9-T16 Pending

### What Works

- **T1 — TypeScript Core Monitor**: ✅ COMPLETE
- **T2 — Telegram/OpenClaw Alert Integration**: ✅ COMPLETE (2026-06-18)
  - `AlertSender.ts`: Telegram Bot API + macOS osascript notifications
  - Drain, spike, and battery impact alerts all wired
  - Per-event cooldowns prevent spam
- **T3 — Per-Process Query Interface**: ✅ COMPLETE
- **T4 — Web Dashboard**: ✅ COMPLETE (Extended 2026-06-19)
  - v1: Basic HTML dashboard (2026-05-18)
  - v2: Full rebuild with charts, profiles, 12 API endpoints (2026-06-10)
  - v3: **Analysis tab** with 6 preset SQL queries, quick stats, export (2026-06-19)
  - v3: **Settings tab** with restart button, confirmation dialog, config management (2026-06-19)
  - Dashboard auto-start via cron (monitors both monitor + dashboard processes)
- **T6 — Process Spike Detection**: ✅ COMPLETE
- **T7 — Battery Impact Correlation**: ✅ COMPLETE
- **T8 — LaunchDaemon Installation**: ✅ COMPLETE

### What's Left to Build (Prioritized)

| Priority | Task | Description | Est. Effort |
|----------|------|-------------|-------------|
| 🔥 HIGH | T9 | Sleep/Wake Correlation Tracking | 2-3h |
| 🔥 HIGH | T10 | "What Drained My Battery?" Report | 3-4h |
| ⚡ MEDIUM | T16 | Native macOS Notifications (UNUserNotificationCenter) | 2h |
| ⚡ MEDIUM | T13 | Process Tree View (Hierarchical) | 2-3h |
| ⚡ MEDIUM | T11 | Natural Language Search / Query Box | 4-5h |
| ⚡ MEDIUM | T12 | Data Export (CSV / Parquet / Grafana) | 2-3h |
| ⚡ MEDIUM | T15 | macOS Energy API Integration | 3-5h |
| 🔮 LOW | T14 | Anomaly Detection with ML | 6-8h |
| 🔮 LOW | T5 | Swift Menubar App | 8-12h |

### Technical Debt (Resolved)

- ~~`sendAlert()` stub~~ — **FIXED** 2026-06-18 (T2 implemented with real alerts)
- ~~No config persistence~~ — **FIXED** 2026-06-18 (config.json + save/load)
- ~~No DB size management~~ — **FIXED** 2026-06-18 (auto-cleanup + manual cleanup in Settings)
- ~~`techContext.md` was stale~~ — **FIXED** 2026-05-19
- ~~Dashboard frontend regression~~ — **FIXED** 2026-06-10
- ~~GitHub repo out of sync~~ — **FIXED** 2026-06-15

### Known Issues

- No formal test framework (Jest configured but no test files written)
- Battery impact data needs longer runtime on battery power (currently 0 events — needs 2% drop over 2+ min while not charging)
- Telegram alerts not tested with real bot token (only verified code path works)

### Timeline

| Date | Milestone | Status |
|------|-----------|--------|
| 2026-05-18 | T1: TypeScript rewrite with core monitoring | ✅ |
| 2026-05-18 | Memory bank initialized, T2-T5 planned | ✅ |
| 2026-05-19 | Expanded metrics + memory bank updated | ✅ |
| 2026-06-09 | T6: Spike detection + T7: Battery impact | ✅ |
| 2026-06-10 | T4: Dashboard rebuilt with full features + T3 queries | ✅ |
| 2026-06-13 | T8: LaunchDaemon plist files created | ✅ |
| 2026-06-15 | T8: LaunchDaemons installed and running | ✅ |
| 2026-06-15 | T6/T7 committed to GitHub, full history restored | ✅ |
| 2026-06-18 | T2: Real alerts (Telegram + macOS notifications) | ✅ |
| 2026-06-18 | Settings tab: full config management + DB cleanup | ✅ |
| 2026-06-18 | Tasks T9-T16 created and prioritized | ✅ |
| 2026-06-19 | T4-ext: Analysis + Settings tabs, 6 SQL queries, export | ✅ |
| *Next* | T9: Sleep/Wake correlation or T10: Reports | ⬜ |

### Current Blockers

- None

### Notes

- DB growth rate: ~11.2 MB/day at 30s interval with full process logging
- Auto-cleanup triggers every ~50 min (100 ticks), checks age + size thresholds
- Config is now fully editable via dashboard and persists to `~/.procmon/config.json`
- Alert system supports both Telegram and macOS native notifications with automatic fallback
