# Mac Process Monitor — Architecture & Implementation

*Project*: mac-process-monitor  
*Version*: 2.0 (TypeScript rewrite)  
*Last Updated*: 2026-05-25  

## Overview

A macOS system monitoring tool that tracks battery level, CPU usage, and memory consumption. Alerts when battery drains rapidly (indicating runaway CPU processes). Rewritten from Python to TypeScript with SQLite time-series storage and a web dashboard.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Monitor (main.ts)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ SystemCollector│  │ DrainAnalyzer │  │ TimeSeriesDB      │  │
│  │ (battery, CPU, │  │ (sliding window│  │ (SQLite storage)   │  │
│  │  processes)    │  │  drain detect) │  │                    │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────┘  │
│         │                  │                    │              │
│         └──────────────────┴────────────────────┘              │
│                            │                                 │
│                     ┌──────┴──────┐                          │
│                     │  30s loop   │                          │
│                     └──────┬──────┘                          │
│                            │                                 │
└────────────────────────────┼─────────────────────────────────┘
                             │
                    ┌────────┴────────┐
                    │  Web Dashboard  │
                    │  (port 3456)    │
                    │  server.ts      │
                    └─────────────────┘
```

## Core Modules

### SystemCollector (`src/core/SystemCollector.ts`)

Collects system state every 30 seconds using `systeminformation` library.

**Battery data**:
- `percent`: Battery percentage (0–100)
- `isCharging`: Whether plugged in
- `timeRemaining`: Minutes until empty/full
- `cycleCount`: Battery cycle count

**Process data**:
- `pid`, `name`, `cpuPercent`, `memoryPercent`, `rssMB`, `vmsMB`, `cmdline`
- Memory: `memRss` from `systeminformation` is in **KB** — converted to MB via `/ 1024`
- Memory percentage: `memRss * 1024 / memTotal.total * 100`

**CPU data**:
- `cpuTotal`: Aggregate CPU load across all cores
- Per-process CPU percentages

**Key design decision**: `getSystemSnapshot()` returns a live snapshot. The dashboard server calls this directly for `/api/snapshot` to ensure current data, bypassing the DB cache.

### DrainAnalyzer (`src/core/DrainAnalyzer.ts`)

Detects rapid battery drain using a sliding window.

**Algorithm**:
1. Maintain a ring buffer of recent battery samples (timestamp, percent)
2. On each new sample, compute drain rate: `(startPercent - endPercent) / durationMinutes`
3. If rate > threshold (default 1%/min), trigger a drain event
4. Drain event includes: start/end time, start/end percent, rate, top CPU processes

**Process attribution**: When drain detected, captures the top N processes by CPU usage at that moment.

### TimeSeriesDB (`src/storage/TimeSeriesDB.ts`)

SQLite storage for time-series data.

**Schema**:
```sql
-- Snapshots (time-series)
snapshots: id, timestamp, battery_percent, is_charging, cpu_total, memory_total

-- Process samples (per-snapshot)
process_samples: id, snapshot_id, pid, name, cpu_percent, memory_percent, rss_mb, vms_mb, cmdline

-- Drain events (detected anomalies)
drain_events: id, start_time, end_time, start_percent, end_percent, drain_rate, duration_minutes

-- Drain event process associations
drain_event_processes: drain_event_id, process_id, cpu_percent, memory_percent
```

**Key methods**:
- `insertSnapshot(snapshot)` — stores snapshot + all processes
- `getSnapshotHistory(minutes)` — returns `{timestamp, battery_percent, cpu_total, memory_total}[]`
- `getDrainEvents()` — returns all drain events with associated processes
- `getLatestSnapshot()` — reconstructs full snapshot from latest DB row

**Note**: Column names are **snake_case** in DB. Frontend code must handle both `battery_percent` and `batteryPercent` for robustness.

### Monitor (`src/main.ts`)

Orchestrator that runs the monitoring loop.

**Loop** (every 30s):
1. Collect snapshot via `SystemCollector`
2. Store in DB via `TimeSeriesDB`
3. Check for drain via `DrainAnalyzer`
4. If drain detected, log event (future: send alert)

**Configuration** (via environment):
- `PROCmon_INTERVAL_MS` — sampling interval (default 30000)
- `PROCmon_DRAIN_THRESHOLD` — drain rate threshold %/min (default 1.0)
- `PROCmon_DB_PATH` — SQLite DB location (default `~/.procmon/monitor.db`)

## Web Dashboard (`src/web/server.ts` + `web/public/`)

Lightweight HTTP server serving a real-time dashboard.

**Server** (`src/web/server.ts`):
- Native Node `createServer` (no Express dependency)
- Serves static files from `web/public/`
- API endpoints:
  - `GET /api/snapshot` — **live collection** (not DB cache)
  - `GET /api/history?minutes=60` — time-series from DB
  - `GET /api/drain-events` — drain events from DB
- CORS enabled for local network access
- Binds to `0.0.0.0:3456` for Android/local network access

**Frontend** (`web/public/app.js`):
- Vanilla JS, no framework dependencies
- Auto-refresh every 5 seconds
- KPI cards: Battery %, CPU %, Memory GB, Status
- Process table: sortable by CPU or memory, top 10 processes
- Battery History chart: CSS-based bar chart with Y-axis (%) and X-axis (time)
- Drain Events panel: list with CSV export

**Styling** (`web/public/styles.css`):
- Dark theme (charcoal background `#0f1115`)
- CSS custom properties for theming
- Responsive: 2-column grid on desktop, 1-column on mobile
- CPU bars with color coding (green → yellow → red)

## Data Flow

```
Monitor Loop (30s):
  SystemCollector.getSystemSnapshot()
    → TimeSeriesDB.insertSnapshot()
    → DrainAnalyzer.addSample()
      → if drain: TimeSeriesDB.insertDrainEvent()

Dashboard Request:
  GET /api/snapshot
    → SystemCollector.getSystemSnapshot() [LIVE]
  GET /api/history
    → TimeSeriesDB.getSnapshotHistory() [DB]
  GET /api/drain-events
    → TimeSeriesDB.getDrainEvents() [DB]
```

## Known Issues & Fixes Applied

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Chart click handlers threw `event.target undefined` | Inline `onclick` handlers rely on global `event` which is unreliable | Pass `this` explicitly: `onclick="sortProcesses('cpu', this)"` |
| Chart rendered empty / `toFixed` on undefined | DB returns `battery_percent` (snake_case), code expected `batteryPercent` (camelCase) | Added fallback: `d.battery_percent ?? d.batteryPercent ?? 0` |
| All process memory showed 0 MB | Server read stale DB cache with old buggy `rssMB` values from May 21 | Changed `/api/snapshot` to use live `SystemCollector` instead of DB |
| Monitor exited immediately | `&` backgrounding + `sleep` caused SIGTERM when parent shell closed | Use `nohup` with log redirection for proper daemonization |

## Development

**Install dependencies**:
```bash
pnpm install
```

**Run monitor** (background):
```bash
nohup pnpm run monitor > ~/.procmon/monitor.log 2>&1 &
```

**Run dashboard** (dev server):
```bash
pnpm run dashboard
# or
npx tsx src/web/server.ts
```

**Access dashboard**:
- Local: http://localhost:3456
- Network: http://192.168.1.103:3456 (from Android/other devices)

**Build**:
```bash
pnpm run build   # tsc compilation
```

## File Structure

```
mac-process-monitor/
├── src/
│   ├── core/
│   │   ├── SystemCollector.ts    # Battery, CPU, process collection
│   │   └── DrainAnalyzer.ts      # Sliding window drain detection
│   ├── storage/
│   │   └── TimeSeriesDB.ts       # SQLite schema + queries
│   ├── types/
│   │   └── index.ts              # TypeScript interfaces
│   ├── web/
│   │   └── server.ts             # Dashboard HTTP server
│   └── main.ts                   # Monitor orchestrator
├── web/public/
│   ├── index.html                # Dashboard markup
│   ├── app.js                    # Frontend logic
│   └── styles.css                # Dark theme styling
├── package.json
├── tsconfig.json
└── memory-bank/                  # Project documentation
```

## Future Work

- **T2**: Telegram/OpenClaw alert integration — send drain alerts via messaging
- **T3**: Per-process query interface — CLI tool for historical process analysis
- **T4**: Dashboard polish — CPU history chart, process memory sorting
- **T5**: Swift menubar app — native macOS UI

## Dependencies

| Package | Purpose |
|---------|---------|
| `systeminformation` | Cross-platform system/battery/process data |
| `better-sqlite3` | SQLite database (synchronous, fast) |
| `tsx` | TypeScript execution (dev) |
| `typescript` | TypeScript compiler |

---

*See also*: `memory-bank/tasks.md` for task tracking, `memory-bank/systemPatterns.md` for design patterns.
