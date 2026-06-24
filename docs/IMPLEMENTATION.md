# Implementation Details — process-monitor

*Last Updated: 2026-06-24*

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Modules](#core-modules)
3. [Data Flow](#data-flow)
4. [Database Schema](#database-schema)
5. [API Endpoints](#api-endpoints)
6. [Cross-Platform Support](#cross-platform-support)
7. [Configuration](#configuration)
8. [Key Design Decisions](#key-design-decisions)
9. [Extension Points](#extension-points)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     DASHBOARD (Web UI)                      │
│  http://localhost:3456 — Vanilla HTML/CSS/JS, no build step │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    DASHBOARD SERVER                         │
│         src/web/server.ts — Native Node.js HTTP             │
│  Serves static files + JSON API endpoints (read-only on DB) │
└────────────────────────┬────────────────────────────────────┘
                         │ SQLite (WAL mode)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              TIME-SERIES DATABASE                           │
│          ~/.procmon/monitor.db — SQLite                    │
│   8 tables: snapshots, process_samples, battery_samples,   │
│   process_spikes, battery_impact, drain_events,             │
│   sleep_wake_events, profiles                               │
└────────────────────────┬────────────────────────────────────┘
                         │ INSERT / UPDATE
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      MONITOR CORE                           │
│              src/main.ts — Collection loop                  │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│   │  System     │ │   Drain     │ │  Battery Impact     │  │
│   │  Collector  │ │  Analyzer   │ │  Analyzer           │  │
│   └─────────────┘ └─────────────┘ └─────────────────────┘  │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│   │  Spike      │ │  Sleep/Wake │ │  Energy Collector   │  │
│   │  Detector   │ │  Detector   │ │  (macOS only)       │  │
│   └─────────────┘ └─────────────┘ └─────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │ Alerts
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      ALERT SENDER                           │
│   Telegram bot OR macOS osascript notification            │
│   Fallback: console.log if neither is configured            │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Modules

### SystemCollector.ts

**Purpose:** Gather system metrics from `systeminformation` library.

**What it collects:**
- `battery()` — percent, isCharging, isPlugged, timeRemaining, cycleCount, temperature
- `currentLoad()` — CPU total, user, system, per-core
- `mem()` — used, active, available, swapUsed, swapTotal
- `fsSize()` — disk usage per filesystem
- `networkStats()` — rx_bytes, tx_bytes per interface (rate computed by delta)
- `processes()` — all processes: pid, name, cpu, mem, ppid, path, user, started
- `cpuTemperature()` — main, cores, max

**Platform notes:**
- `systeminformation` handles cross-platform differences internally
- Battery returns `percent: 0, isPlugged: true` on machines without batteries (Linux servers, desktops)
- Temperature may be `null` on some systems (VMs, missing sensors)

### DrainAnalyzer.ts

**Purpose:** Detect periods of battery drain.

**Algorithm:**
1. Maintain a sliding window of battery samples (last N samples)
2. Check if battery is discharging (not plugged in, not charging)
3. Calculate drop rate: `(startPercent - endPercent) / (duration in minutes)`
4. Trigger if rate ≥ `drainThreshold` (default 1.0%/min) AND duration ≥ `minDurationMs` (default 2 min)
5. Store drain event in `drain_events` table

**Key insight:** Uses the `battery_samples` table (not real-time polling) so analysis can run on historical data too.

### SpikeDetector.ts

**Purpose:** Detect processes that suddenly spike in CPU or memory usage.

**Dual-threshold system:**
1. **Absolute threshold:** CPU > 50% OR memory > 20% of total
2. **Relative threshold:** CPU > 3× baseline OR memory > 3× baseline

**Baseline tracking:**
- Rolling average of last 10 samples per process
- Baseline is per-process, not global
- Only tracks processes that have been seen ≥ 3 times (avoids one-shot spikes)

**Cooldown:** 60-second per-process cooldown to prevent alert spam.

**Platform consideration:** On Linux, kernel threads (`kworker`, `ksoftirqd`, etc.) are filtered out via `ignoredProcesses` in `ConfigManager.ts` to avoid false positives.

### BatteryImpactAnalyzer.ts

**Purpose:** Score which processes are the worst battery drainers over time.

**Algorithm:**
1. During a drain event (from `DrainAnalyzer`), collect all process samples in the drain window
2. For each process: calculate `cpuSeconds = avgCpu * duration / 100`
3. Total `cpuSeconds` for all processes = drain window CPU activity
4. Process score = `(processCpuSeconds / totalCpuSeconds) * batteryDropPercent`
5. Accumulate scores in `battery_impact` table: `INSERT ... ON CONFLICT DO UPDATE SET score = score + newScore`

**Result:** Processes that consistently appear during drain periods accumulate higher scores. A single spike won't dominate; chronic offenders rise to the top.

### SleepWakeDetector.ts

**Purpose:** Detect sleep/wake events and battery state around them.

**Platform-specific implementation:**

```
getPlatform() → 'darwin' | 'linux' | 'windows' | 'other'

┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  macOS   │  │  Linux   │  │ Windows  │  │  Other   │
│ (darwin) │  │ (linux)  │  │ (win32)  │  │          │
├──────────┤  ├──────────┤  ├──────────┤  ├──────────┤
│ ioreg    │  │ sysfs    │  │ No-op    │  │ No-op    │
│ pmset    │  │ BAT0/1   │  │ (log     │  │ (log     │
│          │  │ capacity │  │ warning) │  │ warning) │
│ Sleep    │  │ Sleep:   │  │          │  │          │
│ events:  │  │ always   │  │          │  │          │
│ parse    │  │ "awake"  │  │          │  │          │
│ ioreg    │  │ (servers │  │          │  │          │
│ output   │  │ don't    │  │          │  │          │
│          │  │ sleep)   │  │          │  │          │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
```

**Linux battery reading:**
```bash
# Reads from (in order of preference):
/sys/class/power_supply/BAT0/capacity
/sys/class/power_supply/BAT1/capacity
/sys/class/power_supply/battery/capacity

# Status from:
/sys/class/power_supply/BAT0/status  # "Charging" | "Discharging" | "Full" | "Unknown"
```

**macOS sleep detection:** Uses `ioreg -n IORootParent` to detect power state transitions. The `IOPowerManagement` key has `CurrentPowerState` which changes on sleep/wake.

**No-op fallback:** On unsupported platforms, returns `state: "awake"` with `battery: 0, isPlugged: true`. The monitor's existing tick-gap detection handles missed intervals.

### EnergyCollector.ts (macOS only)

**Purpose:** Collect per-process energy consumption in millijoules using `powermetrics`.

**Requirement:** Requires `sudo` to run `powermetrics`. Without sudo, energy data is not available.

**Integration:** `energy_mj` field added to `process_samples` table. Displayed in process cards when available.

**Platform:** macOS only. Linux has no equivalent per-process energy API at this level.

---

## Data Flow

### Monitor Collection Loop (src/main.ts)

```
tickInterval: 30 seconds (configurable)

Every tick:
  1. Collect system metrics → SystemCollector
  2. Store snapshot in DB → TimeSeriesDB.insertSnapshot()
  3. For each process in snapshot:
     a. Store in process_samples
     b. Update SpikeDetector baseline
     c. Check for spike → if yes, store in process_spikes + sendAlert()
  4. If battery changed:
     a. Store battery sample
     b. Run DrainAnalyzer → if drain detected, store in drain_events
     c. Run BatteryImpactAnalyzer → update scores in battery_impact
  5. Run SleepWakeDetector → if sleep/wake event detected, store in sleep_wake_events
  6. Auto-cleanup: every 100 ticks (~50 min), check DB age + size thresholds
  7. If energy collection enabled (macOS + sudo):
     a. Run EnergyCollector
     b. Merge energy data into process_samples
```

### Dashboard Data Flow (src/web/server.ts)

```
Browser loads → index.html → app.js

App.js initialization:
  1. Fetch /api/identity → device name, endpoints
  2. Fetch /api/snapshot → latest metrics
  3. Fetch /api/db-stats → snapshot count, DB size
  4. Start refresh loop: every 5 seconds
     a. Fetch /api/snapshot
     b. Update KPIs, charts, process table
     c. Update sparklines (mini charts)
  5. If on Devices tab:
     a. Poll /api/metrics for each registered peer every 30s
  6. If on Analysis tab:
     a. Run preset query when button clicked
     b. Fetch /api/analysis/<endpoint> → render results
```

---

## Database Schema

```sql
-- snapshots: One row per 30-second tick
CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,  -- Unix epoch ms
  battery_percent REAL,
  is_charging INTEGER,
  is_plugged INTEGER,
  cpu_total REAL,
  cpu_user REAL,
  cpu_system REAL,
  memory_used_mb REAL,
  memory_total_mb REAL,
  memory_active_mb REAL,
  memory_swap_used_mb REAL,
  memory_swap_total_mb REAL,
  load REAL,
  temperature REAL,
  disk_used_mb REAL,
  disk_total_mb REAL,
  network_rx_bytes INTEGER,
  network_tx_bytes INTEGER
);

-- process_samples: One row per process per tick
CREATE TABLE process_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  pid INTEGER NOT NULL,
  name TEXT NOT NULL,
  cpu REAL,
  mem REAL,
  ppid INTEGER,
  path TEXT,
  user TEXT,
  started TEXT,
  energy_mj REAL  -- macOS only, requires sudo
);

-- battery_samples: One row per battery state change
CREATE TABLE battery_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  battery_percent REAL,
  is_charging INTEGER,
  is_plugged INTEGER,
  time_remaining REAL,
  cycle_count INTEGER,
  temperature REAL
);

-- process_spikes: One row per detected spike
CREATE TABLE process_spikes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  pid INTEGER NOT NULL,
  name TEXT NOT NULL,
  cpu REAL,
  memory REAL,
  baseline_cpu REAL,
  baseline_memory REAL,
  threshold_type TEXT  -- 'absolute' or 'relative'
);

-- battery_impact: Accumulated scores per process
CREATE TABLE battery_impact (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pid INTEGER NOT NULL,
  name TEXT NOT NULL,
  score REAL DEFAULT 0,
  event_count INTEGER DEFAULT 0,
  last_updated INTEGER,
  UNIQUE(pid, name)
);

-- drain_events: One row per detected drain period
CREATE TABLE drain_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  start_battery REAL,
  end_battery REAL,
  rate REAL,
  top_processes TEXT  -- JSON array of {name, pid, cpu_avg}
);

-- sleep_wake_events: Sleep/wake transitions
CREATE TABLE sleep_wake_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,  -- 'sleep' or 'wake'
  battery_percent REAL,
  is_charging INTEGER,
  source TEXT  -- 'ioreg', 'tick_gap', 'manual', etc.
);

-- profiles: Monitoring profiles (UI-configurable groups)
CREATE TABLE profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT,
  processes TEXT NOT NULL,  -- JSON array of process name patterns
  created_at INTEGER,
  updated_at INTEGER
);
```

**WAL mode:** Enabled for concurrent reads (dashboard) while monitor writes.

---

## API Endpoints

### Dashboard Server (src/web/server.ts)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /` | — | Serve `index.html` |
| `GET /api/snapshot` | GET | Latest snapshot + processes + battery + identity |
| `GET /api/db-stats` | GET | Total snapshots, events, DB size, oldest snapshot |
| `GET /api/process-tree` | GET | Hierarchical process tree from `systeminformation.processes()` |
| `GET /api/metrics` | GET | Compact metrics for peer polling (device tab) |
| `GET /api/identity` | GET | Device name, platform, all network endpoints |
| `GET /api/qr` | GET | SVG QR code with pairing payload |
| `GET /api/devices` | GET | List all registered peer devices |
| `POST /api/devices` | POST | Register a new peer device |
| `DELETE /api/devices/:id` | DELETE | Remove a peer device |
| `GET /api/analysis/battery-trend` | GET | Daily average battery drain |
| `GET /api/analysis/top-battery-impact` | GET | Processes with highest cumulative battery impact |
| `GET /api/analysis/spike-frequency` | GET | Spike frequency by process |
| `GET /api/analysis/drain-processes` | GET | Top processes during drain events |
| `GET /api/analysis/cpu-trend` | GET | CPU trend over time |
| `GET /api/analysis/memory-trend` | GET | Memory trend over time |
| `GET /api/sleep-wake-events` | GET | Sleep/wake events with optional days filter |
| `GET /api/export/csv` | GET | Export data as CSV with date range |
| `GET /api/export/json` | GET | Export data as JSON with date range |
| `POST /api/restart` | POST | Restart the monitor process (dynamic path, cross-platform) |
| `POST /api/config` | POST | Update monitor configuration |
| `GET /api/config` | GET | Current configuration |

### Query CLI (src/query.ts)

| Flag | Description |
|------|-------------|
| `--spikes` | Show recent process spikes |
| `--battery` | Show battery impact rankings |
| `--top` | Show top processes by CPU |
| `--process <name>` | Show history for a specific process |
| `--drains` | Show recent drain events |
| `--report` | Generate daily battery report |
| `--output <format>` | `text` or `json` |

---

## Cross-Platform Support

### Platform Detection Strategy

The app uses `process.platform` (Node.js builtin) to branch at runtime:

```typescript
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const isWindows = process.platform === 'win32';
```

**Files with platform-specific code:**

| File | macOS | Linux | Windows | Other |
|------|-------|-------|---------|-------|
| `SystemCollector.ts` | ✅ All features | ✅ All features | ✅ All features | ✅ All features |
| `SleepWakeDetector.ts` | `ioreg` + `pmset` | `sysfs` BAT* | No-op | No-op |
| `AlertSender.ts` | `osascript` notification | Telegram fallback | Telegram fallback | Telegram fallback |
| `EnergyCollector.ts` | `powermetrics` (sudo) | ❌ N/A | ❌ N/A | ❌ N/A |
| `ConfigManager.ts` | macOS + Linux kernel procs | ✅ | ✅ | ✅ |
| `web/server.ts` | ✅ | ✅ | ✅ | ✅ |
| `web/public/app.js` | ✅ | ✅ (N/A battery) | ✅ (N/A battery) | ✅ (N/A battery) |

### Platform-Specific Notes

**macOS (primary target):**
- Full feature set: energy API, native notifications, sleep/wake detection
- LaunchDaemon for auto-start
- `powermetrics` requires sudo

**Linux (tested on Ubuntu VPS):**
- All core features work: monitoring, spikes, drain, battery impact, dashboard
- Battery: reads from `/sys/class/power_supply/` if available; otherwise shows N/A
- Sleep: servers don't sleep, so sleep detection returns "awake"
- Kernel process filtering prevents false spike alerts
- No native notifications (uses Telegram fallback)

**Windows (theoretical):**
- Core monitoring should work (`systeminformation` supports Windows)
- Sleep/wake: no-op (would need Windows-specific API)
- Battery: no-op (would need Windows-specific API)
- Never tested — may need adjustments

**Other platforms (theoretical):**
- Core monitoring should work
- Sleep/battery: no-op with log warning

---

## Configuration

### Config File: `~/.procmon/config.json`

```json
{
  "monitor": {
    "tickIntervalMs": 30000,
    "dbPath": "~/.procmon/monitor.db",
    "enableDrainDetection": true,
    "enableSpikeDetection": true,
    "enableBatteryImpact": true,
    "enableEnergyCollection": false,
    "drainThreshold": 1.0,
    "minDrainDurationMs": 120000,
    "spikeAbsoluteCpuThreshold": 50.0,
    "spikeAbsoluteMemoryThreshold": 20.0,
    "spikeRelativeMultiplier": 3.0,
    "spikeCooldownMs": 60000
  },
  "alerts": {
    "telegramBotToken": "",
    "telegramChatId": "",
    "enableMacOSNotifications": true
  },
  "dashboard": {
    "port": 3456,
    "refreshIntervalMs": 5000
  },
  "cleanup": {
    "maxAgeDays": 30,
    "maxSizeMB": 500
  }
}
```

### Ignored Processes (platform-aware)

```typescript
// macOS kernel + system processes
'kernel_task', 'WindowServer', 'mds', 'mdworker',

// Linux kernel threads
'kworker', 'ksoftirqd', 'rcu_preempt', 'migration',
'watchdogd', 'cpuhp', 'khugepaged', 'kcompactd0', 'oom_reaper'
```

These are filtered out before spike detection and process tree display to avoid noise from OS-level activity.

---

## Key Design Decisions

### 1. SQLite over Time-Series Database

**Why:** SQLite is embedded, zero-config, file-based, and sufficient for personal-scale monitoring. With WAL mode, it handles concurrent reads (dashboard) while the monitor writes. No external dependencies.

**Trade-off:** Not suitable for distributed/cloud-scale monitoring. Querying large ranges (months) may be slow without indexing.

### 2. Native Node.js HTTP Server (no Express)

**Why:** Zero dependencies for the server. The entire dashboard is served with Node.js builtins (`http`, `fs`, `path`). Reduces install time and attack surface.

**Trade-off:** More verbose routing code. No middleware ecosystem.

### 3. Vanilla HTML/CSS/JS (no framework)

**Why:** The dashboard is a simple monitoring UI. No state management complexity. One HTML file, one CSS file, modular JS files. No build step, no bundler, no framework upgrade cycle.

**Trade-off:** Manual DOM manipulation. No component reuse. Mobile responsiveness is harder.

### 4. systeminformation Library

**Why:** Cross-platform system metrics without native modules. Handles macOS, Linux, Windows internally. Well-maintained, comprehensive API.

**Trade-off:** Adds ~5MB dependency. Some metrics are less precise than native tools (e.g., `powermetrics` for energy).

### 5. Dual-Threshold Spike Detection

**Why:** A single threshold misses two cases: (1) a process with 1% baseline spiking to 10% (relative, but not absolute), and (2) a process with 40% baseline spiking to 60% (absolute, but not relative). Dual thresholds catch both.

**Trade-off:** More complex baseline tracking. Needs per-process history.

### 6. Battery Impact Scoring (not just correlation)

**Why:** Simple correlation ("what was running during drain?") would flag every process. Scoring accumulates over time, so chronic offenders rise above one-time spikes. Uses CPU-seconds share, which weights by actual resource usage.

**Trade-off:** Requires drain events to score. If machine is always plugged in, no scores accumulate.

---

## Extension Points

### Adding a New Analyzer

1. Create `src/core/NewAnalyzer.ts`
2. Implement `analyze(snapshot: SystemSnapshot): AnalysisResult | null`
3. Add table in `TimeSeriesDB.ts` for results
4. Call from `Monitor.ts` tick loop
5. Add endpoint in `server.ts` if dashboard exposure needed

### Adding a New Dashboard Tab

1. Add button in `index.html` `<nav class="main-tabs">`
2. Add content div with `id="newTab"` class `tab-content`
3. Add `switchMainTab('new')` handler in `app.js`
4. Add data fetch + render function
5. Add CSS in `styles.css`

### Adding a New Platform

1. Update `SleepWakeDetector.ts` `getPlatform()` to detect new OS
2. Add platform-specific implementation in `detectBattery()` and `detectSleep()`
3. Add kernel/system processes to `ignoredProcesses` in `ConfigManager.ts`
4. Test battery UI shows appropriate state in `app.js`

### Adding a New Alert Channel

1. Add config fields to `ConfigManager.ts` default config
2. Add send function in `AlertSender.ts`
3. Call from `Monitor.ts` `sendAlert()` with priority ordering

---

## Files Reference

```
src/
  main.ts                    — Monitor entry point (collection loop)
  query.ts                   — CLI query tool
  show-data.ts               — Print current system state
  test-*.ts                  — Diagnostic tests
  combined.ts                — Combined monitor + dashboard (single process)
  dashboard.ts               — Standalone dashboard server
  
  types/
    index.ts                 — All TypeScript interfaces
  
  core/
    SystemCollector.ts       — System metric sampling
    DrainAnalyzer.ts         — Battery drain detection
    SpikeDetector.ts       — Per-process spike detection
    BatteryImpactAnalyzer.ts — Drain correlation scoring
    SleepWakeDetector.ts     — Sleep/wake event detection
    EnergyCollector.ts     — macOS energy API (powermetrics)
    Monitor.ts             — Orchestrator loop
    AlertSender.ts         — Telegram + macOS notifications
    DeviceIdentity.ts      — UUIDv4 device identity
    DeviceRegistry.ts      — Peer device registry
  
  storage/
    TimeSeriesDB.ts        — SQLite abstraction layer
  
  web/
    server.ts              — Dashboard HTTP API server
  
  config/
    ConfigManager.ts       — JSON config read/write
  
  dashboard/               — (legacy, use web/ instead)
    server.ts              — Old dashboard server

web/public/                — Dashboard frontend (served by web/server.ts)
  index.html               — Single-page layout
  styles.css               — Dark theme, responsive
  app.js                   — Main orchestration
  utils.js                 — Helpers, API wrappers
  charts.js                — Chart.js configuration
  tables.js                — Sortable table, modal
  profiles.js              — Profile CRUD
```

---

*For high-level project overview, see [README.md](../README.md).*
*For task tracking, see [memory-bank/tasks.md](../memory-bank/tasks.md).*
