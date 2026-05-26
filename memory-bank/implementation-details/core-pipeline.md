# Implementation Details: Core Monitoring Pipeline

*Last Updated: 2026-05-26 13:19 IST*

## Table of Contents
1. [SystemCollector Design](#systemcollector-design)
2. [DrainAnalyzer Design](#drainanalyzer-design)
3. [TimeSeriesDB Design](#timeseriesdb-design)
4. [Monitor Orchestrator](#monitor-orchestrator)
5. [Type System](#type-system)
6. [ESM Import Conventions](#esm-import-conventions)
7. [Known Quirks](#known-quirks)

---

## SystemCollector Design

### Responsibility
Gather all system metrics in a single `Promise.all()` call. Return a `SystemSnapshot` — the universal data unit.

### Metrics Collected

| Metric | Source | Platform Notes |
|---|---|---|
| Battery %, charging, plugged, time remaining, cycles, temp | `si.battery()` | Returns zeros on desktop/VPS |
| CPU total, user, system, idle | `si.currentLoad()` | macOS: `currentLoad` (camelCase). Fallback to `avgLoad` |
| Memory total %, used MB, free MB | `si.mem()` | `total`, `used`, `free` in bytes |
| Swap used MB, total MB | `si.mem()` | `swaptotal`, `swapused` in bytes |
| Load average | `si.currentLoad()` | `avgLoad` field |
| Disk I/O (read/write/total) | `si.disksIO()` | Cumulative counters, not rates. Optional: `.catch(() => null)` |
| Network rx/tx bytes | `si.networkStats()` | First active interface (`operstate === 'up'`). Optional |
| Disk usage % | `si.fsSize()` | Primary mount (`/` on Linux/macOS, `C:\` on Windows). Optional |
| CPU temperature | `si.cpuTemperature()` | Often `null` on VMs. Optional |
| Top 50 processes | `si.processes()` | Sorted by CPU descending |

### Parallelization Strategy
All `systeminformation` calls are independent and fetched in parallel via `Promise.all()`. Optional metrics (disk IO, network, temp, fsSize) use `.catch(() => null)` so a failure in one doesn't kill the entire snapshot.

### Process Sampling
- `si.processes()` returns all processes; we sort by `cpu` descending and slice top 50
- `memRss` is in **KB** (not bytes). `rssMB = memRss / 1024`
- `memVsz` is in bytes. `vmsMB = memVsz / 1024 / 1024`
- `memoryPercent = memRss * 1024 / memTotal.total * 100`
- Per-process CPU breakdown: `cpuu` (user), `cpus` (system) from `si.processes()`

### Error Handling
```typescript
const [battery, processes, load, mem, diskIO, netStats, fsSize, cpuTemp] = await Promise.all([
  this.getBattery(),
  this.getProcesses(),
  si.currentLoad(),
  si.mem(),
  si.disksIO().catch(() => null),
  si.networkStats().catch(() => []),
  si.fsSize().catch(() => []),
  si.cpuTemperature().catch(() => ({ main: null, max: null })),
]);
```

---

## DrainAnalyzer Design

### Responsibility
Detect rapid battery drain by analyzing a sliding window of `SystemSnapshot`s. Correlate drain events with CPU-intensive processes.

### Window Sizing
```typescript
constructor(windowMinutes: number = 5, sampleIntervalSeconds: number = 30) {
  this.maxSamples = Math.ceil((windowMinutes * 60) / sampleIntervalSeconds) + 1;
  // Default: ceil(300 / 30) + 1 = 11 samples
}
```
The `+ 1` ensures the window always has enough samples even with slight timing jitter.

### Analysis Algorithm (`analyze()`)
1. **Cooldown check**: `now - lastAlertTime < cooldownMs` → return null
2. **Charging check**: `newest.battery.isCharging || newest.battery.isPlugged` → return null
3. **Duration check**: `(newest.timestamp - oldest.timestamp) / 60000 < minDurationMinutes` → return null
4. **Drop check**: `oldest.battery.percent - newest.battery.percent <= 0` → return null (battery went up or stayed flat)
5. **Rate check**: `dropRate = percentDrop / durationMinutes`. If `dropRate < drainThreshold` → return null
6. **Trigger**: Build `DrainEvent`, set `lastAlertTime = now`, return event

### Process Correlation (`findTopProcessesDuringDrain()`)
1. Create a Map keyed by PID
2. For each sample in the window, for each process: accumulate `cpuPercent` and count occurrences
3. Divide total CPU by count to get average CPU per process during the drain window
4. Sort descending, return top 5

**Limitation**: PID reuse within a 5-minute window is rare but possible. Two different processes could share a PID if one exited and another started. This is a known limitation; cross-window identity is not guaranteed.

---

## TimeSeriesDB Design

### Schema

#### `snapshots` — system-wide metrics per sample
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| timestamp | INTEGER NOT NULL | Unix epoch ms |
| battery_percent | REAL NOT NULL | |
| is_charging | INTEGER NOT NULL | 0/1 boolean |
| cpu_total | REAL | |
| cpu_user | REAL | Added 2026-05-19 |
| cpu_system | REAL | Added 2026-05-19 |
| cpu_idle | REAL | Added 2026-05-19 |
| memory_total | REAL | |
| memory_used_mb | REAL | Added 2026-05-19 |
| memory_free_mb | REAL | Added 2026-05-19 |
| swap_used_mb | REAL | Added 2026-05-19 |
| swap_total_mb | REAL | Added 2026-05-19 |
| load_avg | REAL | Added 2026-05-19 |
| disk_read_io | REAL | Added 2026-05-19 |
| disk_write_io | REAL | Added 2026-05-19 |
| disk_total_io | REAL | Added 2026-05-19 |
| net_rx_bytes | REAL | Added 2026-05-19 |
| net_tx_bytes | REAL | Added 2026-05-19 |
| fs_used_percent | REAL | Added 2026-05-19 |
| cpu_temp | REAL | Added 2026-05-19 |

#### `process_samples` — per-process metrics per snapshot
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| snapshot_id | INTEGER NOT NULL | FK → snapshots.id |
| pid | INTEGER NOT NULL | |
| name | TEXT NOT NULL | |
| cpu_percent | REAL NOT NULL | |
| cpu_user_percent | REAL | Added 2026-05-19 |
| cpu_system_percent | REAL | Added 2026-05-19 |
| memory_percent | REAL NOT NULL | |
| rss_mb | REAL NOT NULL | |
| nice | INTEGER | Added 2026-05-19 |
| state | TEXT | Added 2026-05-19 |
| cmdline | TEXT | |

#### `drain_events` — detected rapid drain incidents
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | `timestamp-random` |
| start_time | INTEGER NOT NULL | |
| end_time | INTEGER NOT NULL | |
| start_percent | REAL NOT NULL | |
| end_percent | REAL NOT NULL | |
| drain_rate | REAL NOT NULL | % per minute |
| duration_minutes | REAL NOT NULL | |
| was_charging | INTEGER NOT NULL | 0/1 |
| top_processes_json | TEXT NOT NULL | Serialized `ProcessSnapshot[]` |

### Auto-Migration
```typescript
private migrateSchema(): void {
  const snapshotCols = [
    { name: 'cpu_user', type: 'REAL' },
    // ... 15 columns total
  ];
  for (const col of snapshotCols) {
    if (!this.tableHasColumn('snapshots', col.name)) {
      this.db.exec(`ALTER TABLE snapshots ADD COLUMN ${col.name} ${col.type}`);
    }
  }
}
```
This allows upgrading the DB without data loss. Old rows will have `NULL` for new columns.

### WAL Mode
```typescript
this.db.pragma('journal_mode = WAL');
```
- Readers don't block writers
- Writers don't block readers
- Required for T4 dashboard to query while monitor writes
- Checkpoints happen automatically; `close()` ensures clean shutdown

### Transaction Strategy
`insertSnapshot()` uses a `better-sqlite3` transaction:
```typescript
const insertProc = this.db.transaction((processes) => {
  for (const proc of processes) {
    procStmt.run(...);
  }
});
insertProc(snapshot.processes);
```
All process rows for a snapshot are written atomically.

---

## Monitor Orchestrator

### Lifecycle
1. `new Monitor(config)` — creates collector, analyzer, DB
2. `start()` — initial `tick()`, then `setInterval(tick, intervalMs)`
3. `tick()` — collect → store → analyze → alert
4. `stop()` — clears interval, closes DB
5. SIGINT/SIGTERM — `main.ts` calls `monitor.stop()` then exits

### Tick Sequence
```
tick()
  └─> collector.getSystemSnapshot()
        └─> db.insertSnapshot(snapshot)
        └─> analyzer.addSample(snapshot)
        └─> analyzer.analyze(threshold, minDuration, cooldown)
              └─> if event: handleDrainEvent(event)
                    └─> db.insertDrainEvent(event)
                    └─> sendAlert(event)  // formats message, T2 will dispatch
```

### Periodic Cleanup
```typescript
if (Math.random() < 0.01) {  // ~1% chance per tick
  this.db.cleanupOldSamples(this.config.retentionDays);
}
```
This is a placeholder. At 30s intervals, ~1% = once every ~50 minutes. A scheduled approach (every N ticks or at startup) would be more predictable.

---

## Type System

All types live in `src/types/index.ts`. They are pure interfaces with no methods — designed for easy porting to Swift (T5).

### Design Principle
Every field that `systeminformation` might return as negative or missing is typed as nullable:
- `timeRemaining: number | null` (negative = "calculating")
- `cycleCount: number | null` (negative = unavailable)
- `temperature: number | null` (negative = unavailable)
- `cpuTemp: number | null` (null = no thermal sensors)
- `diskReadIO: number | null` (null = disk IO API failed)

This prevents the monitor from crashing when a sensor or API is unavailable.

---

## ESM Import Conventions

Source files import with `.js` extensions:
```typescript
import { SystemCollector } from './core/SystemCollector.js';
```

This is required because:
1. Node.js ESM resolution requires explicit file extensions
2. `tsx` resolves `.js` → `.ts` at runtime during development
3. `tsc` compiles `.ts` → `.js`, so the paths remain valid in `dist/`

Without this convention, the code fails under pure Node.js ESM (no tsx).

---

## Known Quirks

### Battery Property Casing

`systeminformation` v5 returns battery fields in camelCase:
- `isCharging` (not `ischarging`)
- `acConnected` (not `acconnected`)
- `timeRemaining` (not `timeremaining`)
- `cycleCount` (not `cyclecount`)

These were incorrectly read as lowercase in early versions. Fixed in `SystemCollector.ts`:

```typescript
return {
  isCharging: battery.isCharging,
  isPlugged: battery.acConnected,
  timeRemaining: battery.timeRemaining >= 0 ? battery.timeRemaining : null,
  cycleCount: battery.cycleCount >= 0 ? battery.cycleCount : null,
};
```

### `currentLoad` Casing
`systeminformation` v5 returns `currentLoad` and `avgLoad` (camelCase). Earlier versions or certain platforms may differ. The code uses:
```typescript
const cpuTotal = load?.currentLoad ?? load?.avgLoad ?? 0;
```

### `memRss` Units
`systeminformation` returns `memRss` in **KB**, not bytes. This was initially misread as bytes, causing `rssMB` to be 1024× too large. Fixed during T1.

### Battery on Desktop/VPS
`si.battery()` always returns `hasBattery: false` and `percent: 0` on systems without a battery. The drain analyzer correctly skips these (charging check fails because `isPlugged` is often true even without battery).

### Disk I/O Cumulative Counters
`si.disksIO()` returns cumulative read/write operation counts since boot, not rates. To calculate rates, you need `(current - previous) / deltaTime`. The monitor stores raw cumulative values; rate calculation is a future enhancement.

### Network Interface Selection
The monitor picks the first interface where `operstate === 'up' && (rx_bytes > 0 || tx_bytes > 0)`. On multi-interface systems, this may not be the primary interface. A more robust approach would track the interface with the most traffic.

### Process CPU is Point-in-Time
`si.processes()` CPU percentages are instantaneous at the moment of the call, not averaged over the sampling interval. A process that spikes to 100% for 1 second and sleeps for 29 seconds may show low CPU if sampled at the wrong moment.