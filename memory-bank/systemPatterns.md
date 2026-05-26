# System Patterns: mac-process-monitor

## System Architecture
The monitor follows a pipeline architecture where each stage is independent and can be tested in isolation:

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│                 │      │                 │      │                 │      │                 │
│  SystemCollector│─────▶│  DrainAnalyzer  │─────▶│  TimeSeriesDB   │─────▶│  sendAlert()    │
│  (data gather)  │      │  (math + logic) │      │  (persistence)  │      │  (notification) │
│                 │      │                 │      │                 │      │                 │
└─────────────────┘      └─────────────────┘      └─────────────────┘      └─────────────────┘
        ▲                                                                            ▲
        │                                                                            │
        │         ┌──────────────────────────────────────────────────────────────┐   │
        │         │                                                              │   │
        └─────────│                        Monitor                                │───┘
                  │              (orchestrator: start/stop/tick)                │
                  │                                                              │
                  └──────────────────────────────────────────────────────────────┘
                                     │
                                     │ WAL mode
                                     │ (concurrent reads)
                                     ▼
                           ┌─────────────────────┐
                           │   DashboardServer   │
                           │   (port 3456)       │
                           │   Native Node http  │
                           │   src/combined.ts   │
                           └─────────────────────┘
                                     │
                                     ▼
                           ┌─────────────────────┐
                           │  Vanilla JS + HTML  │
                           │  (web/public/)      │
                           │  SVG line charts    │
                           └─────────────────────┘
```

## Key Components

### SystemCollector (`src/core/SystemCollector.ts`)
- Samples battery, processes, CPU load, memory, swap, disk I/O, network, disk usage, temperature
- Uses `Promise.all()` to parallelize independent `systeminformation` calls
- Gracefully degrades: optional metrics (disk IO, network, temp) use `.catch(() => null)`
- Returns `SystemSnapshot` — the universal data unit containing everything at one timestamp
- Sorts processes by CPU descending, returns top 50

### DrainAnalyzer (`src/core/DrainAnalyzer.ts`)
- Maintains a rolling buffer of `SystemSnapshot`s sized for the analysis window
- Default: 5-minute window at 30s intervals = ~11 samples
- `analyze()` checks four conditions before triggering:
  1. Cooldown expired (default: 10 min since last alert)
  2. Not currently charging
  3. Battery dropped over min duration (default: 2 min)
  4. Drop rate exceeds threshold (default: 1%/min)
- `findTopProcessesDuringDrain()`: aggregates CPU per PID across all samples in window, averages, returns top 5
- Process identity is by PID within the window (PID reuse across windows is not handled)

### TimeSeriesDB (`src/storage/TimeSeriesDB.ts`)
- SQLite with three tables: `snapshots`, `process_samples`, `drain_events`
- WAL mode enabled for concurrent reads (dashboard T4 can query while monitor writes)
- Auto-migration: `migrateSchema()` checks `PRAGMA table_info` and adds missing columns
- `insertSnapshot()`: writes 1 snapshot row + N process rows in a transaction
- `insertDrainEvent()`: stores event + serialized top processes JSON
- `cleanupOldSamples()`: deletes snapshots older than retention days (cascade via FK)

### DashboardServer (`src/combined.ts` or `src/web/server.ts`)
- Native Node.js `http` server — no Express dependency
- Two deployment modes:
  - **Unified** (`src/combined.ts`): Monitor + server in one process, shared DB
  - **Standalone** (`src/web/server.ts`): Server only, queries existing DB
- Serves static files from `web/public/` (index.html, app.js, styles.css)
- Nine JSON API endpoints:
  - `/api/snapshot` — live system snapshot
  - `/api/history?minutes=N` — time-series history
  - `/api/drain-events` — all drain events
  - `/api/process-history?name=X&minutes=N` — per-process history
  - `/api/process-stats?name=X&minutes=N` — process statistics
  - `/api/top-processes?metric=cpu&limit=N` — top processes
  - `/api/profiles` — process profile management
  - `/api/db-size` — SQLite DB size
  - `/api/server-info` — server uptime and metadata
- WAL mode enables concurrent reads without blocking the monitor writer
- Port 3456, no auth (local-only)

### Monitor (`src/core/Monitor.ts`)
- Orchestrator: `start()` → recurring `tick()` every `sampleIntervalSeconds`
- `tick()`: collect → store → analyze → alert (if drain detected)
- `handleDrainEvent()`: logs to console, stores in DB, calls `sendAlert()`
- `sendAlert()`: currently formats message only; T2 will add actual dispatch
- Periodic cleanup: 1% random chance per tick (should be changed to scheduled)

## Data Flow
1. `Monitor.tick()` calls `SystemCollector.getSystemSnapshot()`
2. Snapshot stored in SQLite via `TimeSeriesDB.insertSnapshot()`
3. Snapshot added to `DrainAnalyzer` rolling buffer
4. `DrainAnalyzer.analyze()` checks drain conditions
5. If drain detected: `Monitor.handleDrainEvent()` → store event + call `sendAlert()`
6. Status logged every 60 seconds by `main.ts`

## Design Patterns

### Pipeline Pattern
Each component has one input and one output. `SystemCollector` outputs snapshots; `DrainAnalyzer` takes snapshots and outputs events; `TimeSeriesDB` takes both and persists them. Components can be swapped or tested independently.

### Rolling Window Pattern
`DrainAnalyzer` uses a fixed-size array (`maxSamples`) that drops oldest when full. This provides O(1) memory regardless of runtime duration.

### Denormalization for Speed
Process data is stored per-snapshot (up to 50 rows per tick) rather than normalized into a `processes` table. This avoids JOINs for the most common query: "what was running during this snapshot?"

### Auto-Migration
DB schema is additive only. New columns are added via `ALTER TABLE` if missing. Old data remains compatible. This allows seamless upgrades without data loss.

## Technical Decisions

### TypeScript over Python
- Type safety for time-series data contracts (interfaces are the schema)
- ESM module system for clean imports
- Single language for monitor + dashboard (T4)
- Easier Swift port: simple interfaces map directly to Swift structs

### systeminformation over psutil
- Richer battery data (time remaining, cycle count, temperature, design/max capacity)
- Cross-platform by default (macOS, Linux, Windows)
- Single dependency instead of Python venv + psutil + PyYAML stack

### better-sqlite3 over async sqlite
- Synchronous API eliminates async/await complexity in tight monitoring loop
- Faster for the write-heavy pattern (1 snapshot + 50 processes every 30s)
- Native bindings with prebuilt binaries (no compile needed on most systems)

### Polling over Event-Based
- Predictable system load at known intervals
- Simpler implementation — no kernel event hooks needed
- Works cross-platform without platform-specific event APIs

### ESM with `.js` Import Extensions
- Node.js ESM requires `.js` in import paths
- `tsx` resolves `.ts` at runtime during development
- `tsc` compiles to `.js` so paths remain valid in production `dist/`

## Future Language Migration Strategy (for T5 Swift)
1. SQLite DB format is language-agnostic — Swift app reads same DB
2. Core interfaces (`SystemSnapshot`, `DrainEvent`, etc.) are simple structs — direct Swift translation
3. Drain detection algorithm in `DrainAnalyzer.ts` is self-contained, ~100 lines
4. `systeminformation` equivalent on macOS: `IOKit` for battery, `Foundation` for process data
