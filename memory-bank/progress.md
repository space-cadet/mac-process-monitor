# Progress Report: process-monitor

*Last Updated: 2026-06-26 11:40 IST*

## Project Status: T1-T17 Complete + Cross-Platform Fixes; T5 (Swift), T11 (NL Search), T14 (ML) Remaining

### What Works

- **T1 — TypeScript Core Monitor**: ✅ COMPLETE
- **T2 — Telegram/OpenClaw Alert Integration**: ✅ COMPLETE (2026-06-18)
- **T3 — Per-Process Query Interface**: ✅ COMPLETE
- **T4 — Web Dashboard**: ✅ COMPLETE (v4, 2026-06-22)
- **T6 — Process Spike Detection**: ✅ COMPLETE
- **T7 — Battery Impact Correlation**: ✅ COMPLETE
- **T8 — LaunchDaemon Installation**: ✅ COMPLETE
- **T9 — Sleep/Wake Correlation Tracking**: ✅ COMPLETE (2026-06-24)
  - `sleep_wake_events` table + `/api/sleep-wake-events` endpoint
  - Sleep tab in dashboard with timeline
  - **Cross-platform fix (2026-06-24):** `SleepWakeDetector.ts` now detects OS via `getPlatform()` — macOS uses `ioreg`+`pmset`, Linux reads `/sys/class/power_supply/BAT*/capacity`, others gracefully no-op.
- **T10 — "What Drained My Battery?" Report**: ✅ COMPLETE (2026-06-24)
  - `ReportGenerator.ts` with daily battery health scoring
  - `--report` CLI flag with `--output` format (text/json)
  - Reports tab in dashboard with insights, drain events, top culprits
  - Auto-generates at 22:00 daily via cron
- **T12 — Data Export (CSV/JSON)**: ✅ COMPLETE (2026-06-24)
  - `/api/export/csv` and `/api/export/json` with date range picker
  - Export UI in Reports tab
- **T13 — Process Tree View**: ✅ COMPLETE (2026-06-24)
  - `/api/process-tree` endpoint returns hierarchical tree
  - Tree/List toggle in Processes tab
  - **UI improvements (2026-06-24):** Split path display (dir dimmed + basename bright), type badges (system/daemon/user), bigger toggles, parent row highlight, gradient tree guide lines
  - **Search bar:** Added filter input for both list and tree views (searches name + PID)
  - **Mobile layout:** Deferred — CSS `max-content` approach for auto-sized name column not working as expected. To revisit.
- **T15 — macOS Energy API Integration**: ✅ COMPLETE (2026-06-24)
  - `EnergyCollector.ts` — `powermetrics` integration for per-process energy (mJ)
  - `energy_mj` field in DB, shown in process cards
- **T17 — Multi-Device Dashboard**: ✅ COMPLETE V1 (2026-06-24)
  - `DeviceIdentity.ts` — UUIDv4 device identity, persisted to `~/.procmon/config/device.json`
  - `DeviceRegistry.ts` — JSON-based device registry with peer discovery
  - `/api/identity` — returns device info + all network endpoints (localhost, LAN, Tailscale)
  - `/api/qr` — SVG QR code for pairing
  - `/api/metrics` — peer metrics endpoint for polling
  - Peer polling in dashboard — fetches metrics from registered devices every 30s
  - Devices tab with online/offline status cards
  - Network auto-detection: LAN (`192.168.x`), Tailscale (`100.x`), localhost
- **Cross-Platform Fixes**: ✅ COMPLETE (2026-06-24 + 2026-06-26)
  - `SleepWakeDetector.ts` — OS-aware platform detection (darwin/linux/windows/other). macOS: `ioreg`+`pmset`. Linux: `/sys/class/power_supply/BAT*/capacity`. Others: graceful no-op.
  - `web/server.ts` `/api/restart` — removed hardcoded `/Users/sage` path, now uses `process.cwd()` + `process.env.HOME || '/tmp'`
  - `ConfigManager.ts` — added Linux kernel processes (`kworker`, `ksoftirqd`, `rcu_preempt`, etc.) to `ignoredProcesses`
  - `web/public/app.js` — battery UI shows "No battery" / "Desktop / Server" on battery-less machines instead of `0%`
  - **Disk usage fix (2026-06-26):** `SystemCollector.ts` — on macOS Catalina+, prefer `/System/Volumes/Data` (data volume) over `/` (read-only system volume). Fixes bug where MacBooks showed ~20% usage when actually ~80% full.
  - Repo renamed: `mac-process-monitor` → `process-monitor` on GitHub and locally

### What's Left to Build

| Priority | Task | Description | Est. Effort |
|----------|------|-------------|-------------|
| ⚡ HIGH | T20 | Dashboard Detail Views — clickable KPI cards switching context-aware detail panel | 6-8h |
| ⚡ MEDIUM | T11a-d | Natural Language Search — decomposed into 4 beads subtasks (see workspace beads queue) | 4-5h total |
| 🔮 LOW | T14 | Anomaly Detection with ML | 6-8h |
| 🔮 LOW | T5 | Swift Menubar App | 8-12h |
| 🔮 LOW | T18 | Relay Server for Cross-Network (Android+NordVPN) | 3-4h |

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
- **Disk/Network chart y-axis**: Auto-scales correctly now, but very low activity periods show flat lines (expected — counters don't change when idle)
- **T17 limitation**: Android can't run Tailscale + NordVPN simultaneously; LAN-only works for same-network monitoring
- **T17 limitation**: No relay server for cross-network VPN devices; direct P2P only

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
| 2026-06-22 | T4-ext2: Disk/Network monitoring, auto-save, drain settings | ✅ |
| 2026-06-24 | T9-T10: Sleep/wake + Reports (ReportGenerator, CLI, dashboard) | ✅ |
| 2026-06-24 | T12-T13-T15: Data export + Process tree + Energy API | ✅ |
| 2026-06-24 | T17: Multi-Device V1 — identity, QR, peer polling, Tailscale | ✅ |
| 2026-06-24 | Cross-Platform Fixes — SleepWakeDetector, restart path, ignored processes, battery UI | ✅ |
| 2026-06-26 | T20 Phase 1: Clickable KPI cards with detail view switching (CPU→process list, others→placeholders) | ✅ |
| 2026-06-26 | Disk usage fix — prefer `/System/Volumes/Data` on macOS Catalina+ for accurate reporting | ✅ |
| *Next* | T20 Phase 2: Memory detail view (process list sorted by memory + pressure gauge) | ⬜ |

### Current Blockers

- None

### Notes

- DB growth rate: ~11.2 MB/day at 30s interval with full process logging (Mac). On Linux VPS with lighter load: ~0.5 MB/day.
- Auto-cleanup triggers every ~50 min (100 ticks), checks age + size thresholds
- Config is now fully editable via dashboard and persists to `~/.procmon/config.json`
- Alert system supports both Telegram and macOS native notifications with automatic fallback
- **Cross-platform:** Now runs on macOS (primary) and Linux (VPS-tested). Windows support is theoretical (no-op for sleep/battery, rest should work)
- **Repo location:** `code/process-monitor/` (renamed from `mac-process-monitor` 2026-06-24)
- **GitHub:** `https://github.com/space-cadet/process-monitor`
